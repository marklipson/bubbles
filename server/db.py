import os
import json
import copy
import uuid
import tempfile
import re
import shutil
import zipfile
import time
import threading


class Db(object):
    """
    Simple database in a folder, one table per subfolder.
    """
    def __init__(self, folder=None, in_memory=False, on_backup=None):
        """
        Create a simple database.
        :param folder:      Where to store it on disk.  Omit for in-memory or to store in a temporary folder.
        :param in_memory:   Whether to store it in memory.
        :param on_backup:   Function to call with names of all new backup files.
        """
        self.memory = in_memory
        if not folder:
            self.temp = True
            self.folder = "" if in_memory else tempfile.mkdtemp()
        else:
            mkdir_deep(folder)
            self.temp = False
            self.folder = folder
        self.tables = {}
        self.journals = {}
        self.files = {}
        self.on_close = []
        self.on_backup = on_backup
        self.BACKUP_FOLDER = "_backup_"
        self.BACKUP_TIME = "_backup_time_"
        self.ARCHIVE_FOLDER = "_archive_"

    def close(self):
        """
        Release resources.
        """
        for h in self.on_close:
            h()
        if self.temp and self.folder:
            shutil.rmtree(self.folder)

    def purge(self):
        """
        Erase entirely.
        """
        for t in self.tables.values():
            t.purge()
        for j in self.journals.values():
            j.purge()
        for f in self.files.values():
            f.purge()
        if self.folder:
            shutil.rmtree(self.folder)

    def archive(self, name, query=None):
        """
        Move a table, journal or file to the archive.
        :param name:   Which named object to archive.
        :param query:  Optionally limit which records are moved from a table.
        """
        # prevent break-out
        if not self.valid_name(name):
            return
        # locate source data
        src = os.path.join(self.folder, name)
        if os.path.exists(src):
            if name in self.tables and query:
                # archive individual records
                tbl = self.table(name)
                arc_tbl = self.table(self.ARCHIVE_FOLDER + "/" + name)
                for uid, rec in tbl.read_all(query).items():
                    arc_tbl.write(rec)
                    tbl.delete(uid)
            elif name in self.journals and query:
                j = self.journal(name)
                arc_j = self.journal(self.ARCHIVE_FOLDER + "/" + name)
                for rec in j.read_all(query):
                    arc_j.append(rec)
                # TODO data added during this scan will be lost - could rename, filter, append instead
                preserve = list(j.read_all(lambda rec: not query(rec)))
                arc_keep = self.journal(name)
                arc_keep.purge()
                for rec in preserve:
                    arc_keep.append(rec)
            else:
                # archive entire tables/etc.
                shutil.move(src, os.path.join(self.folder, self.ARCHIVE_FOLDER, name))

    def table(self, name, **kwargs):
        if not self.valid_name(name):
            return
        t = self.tables.get(name)
        if not t:
            table_class = TableM if self.memory else Table
            self.tables[name] = t = table_class(os.path.join(self.folder, name), **kwargs)
        return t

    def journal(self, name, **kwargs):
        if not self.valid_name(name):
            return
        j = self.journals.get(name)
        if not j:
            fn = os.path.join(self.folder, name)
            journal_class = JournalM if self.memory else Journal
            self.journals[name] = j = journal_class(fn, **kwargs)
        return j

    def list_files(self, subfolder: str):
        """
        Enumerate available files in a subfolder.
        """
        candidates = []
        if self.memory:
            candidates = self.files.keys()
        else:
            for path, _, files in os.walk(self.folder):
                rel_path = path[len(self.folder)+1:]
                for f in files:
                    candidates.append(os.path.join(rel_path, f))
        prefix = subfolder + "/"
        return filter(lambda f: f.startswith(prefix), candidates)

    def file(self, name):
        if not self.valid_name(name):
            return
        f = self.files.get(name)
        if not f:
            fn = os.path.join(self.folder, name)
            file_class = FileM if self.memory else File
            self.files[name] = f = file_class(fn)
        return f

    def backup(self, name=None, max_keep=50):
        """
        Save a copy of the database.
        """
        if not self.folder:
            return
        to_folder = os.path.join(self.folder, self.BACKUP_FOLDER)
        if not os.path.exists(to_folder):
            os.mkdir(to_folder)
        existing = os.listdir(to_folder)
        # only keep the last (max_keep) latest backups
        n_existing = len(existing)
        if (n_existing+1) > max_keep:
            existing.sort()
            for to_remove in existing[:max_keep - (n_existing + 1)]:
                os.remove(os.path.join(to_folder, to_remove))
        # create the backup
        t_now = time.time()
        to_filename = name or time.strftime("%Y%m%d_%H%M%S.zip", time.localtime(t_now))
        to_fullpath = os.path.join(to_folder, to_filename)
        with zipfile.ZipFile(to_fullpath, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
            the_root = None
            for path, dirs, files in os.walk(self.folder):
                if not the_root:
                    the_root = path
                if os.path.split(path)[1] == self.BACKUP_FOLDER:
                    continue
                rel = path[len(the_root):].strip("/")
                for f in files:
                    src = os.path.join(path, f)
                    dst = os.path.join(rel, f)
                    zf.write(src, dst)
        if self.on_backup:
            self.on_backup(to_fullpath)

    def auto_backup(self, interval=3600*3, check_delay=3, max_keep=50):
        """
        Set up a restartable loop which backs up the database every so often.
        :returns:  A method that will stop the background thread.
        """
        # time of last backup
        f_last_backup = self.file(self.BACKUP_TIME)
        if not f_last_backup.read():
            f_last_backup.write(time.time())
        keep_going = [True]
        def run():
            while keep_going:
                t_now = time.time()
                time.sleep(check_delay)
                if t_now < (f_last_backup.read() or 0) + interval:
                    continue
                f_last_backup.write(t_now)
                self.backup(max_keep=max_keep)
        args = {"daemon": True} if py3 else {}
        threading.Thread(target=run, **args).start()
        def stop():
            del keep_going[:]
        self.on_close.append(stop)
        return stop

    @staticmethod
    def valid_name(name, paths=True):
        if paths:
            return re.match(r'^([0-9a-z_]+)(/[0-9a-z_]+)*$', name) is not None
        return re.match(r'^[0-9a-z_]+$', name) is not None


class Table(object):
    """
    Simple table, each file is a row, filename is ID of record.
    """
    def __init__(self, folder, write_listener=None):
        self.folder = folder
        self.write_listener = write_listener
        if folder:
            mkdir_deep(folder)

    @staticmethod
    def uuid():
        return str(uuid.uuid4()).replace("-", "")[:16]

    def read(self, uid):
        if not uid:
            return
        if not Db.valid_name(uid):
            return
        fn = os.path.join(self.folder, uid)
        if not os.path.exists(fn):
            return
        with open(fn, 'r') as f_r:
            try:
                rec = json.load(f_r)
            except ValueError:
                return
            rec["id"] = uid
        return rec

    def read_all(self, query=None):
        out = {}
        if not os.path.exists(self.folder):
            return out
        for uid in os.listdir(self.folder):
            rec = self.read(uid)
            if rec:
                if not query or query(rec):
                    out[uid] = rec
        return out

    def write(self, record):
        uid = record.get("id")
        if not uid:
            record = dict(record)
            record["id"] = uid = self.uuid()
        if not Db.valid_name(uid):
            return
        if self.write_listener:
            self.write_listener(record)
        fn = os.path.join(self.folder, uid)
        with tempfile.NamedTemporaryFile(delete=False, mode='w', dir=self.folder, prefix=".tmp_") as f_tmp:
            json.dump(record, f_tmp)
            os.rename(f_tmp.name, fn)
        return uid

    def delete(self, uid):
        if not Db.valid_name(uid):
            return
        fn = os.path.join(self.folder, uid)
        if os.path.exists(fn):
            os.remove(fn)

    def purge(self):
        for fn in os.listdir(self.folder):
            os.remove(os.path.join(self.folder, fn))


class Journal(object):
    """
    Linear record of events.
    """
    def __init__(self, filename, write_listener=None):
        self.filename = filename
        self.write_listener = write_listener
        mkdir_deep(os.path.dirname(filename))

    def append(self, message):
        """
        Add a message.
        """
        if self.write_listener:
            self.write_listener(message)
        content = json.dumps(message, separators=",:") + "\n"
        with open(self.filename, 'a') as f_w:
            f_w.write(content)

    def read_all(self, query=None):
        """
        Iterate all messages.
        """
        if not os.path.exists(self.filename):
            return
        with open(self.filename, 'r') as f_r:
            for line in f_r:
                try:
                    rec = json.loads(line)
                    if not query or query(rec):
                        yield rec
                except ValueError:
                    pass

    def purge(self):
        """
        Delete all messages.
        """
        if os.path.exists(self.filename):
            os.remove(self.filename)


class File(object):
    """
    A single block of data.
    """
    def __init__(self, filename):
        self.filename = filename

    def read(self):
        """
        Access the data.
        """
        if not os.path.exists(self.filename):
            return
        with open(self.filename, 'r') as f_r:
            try:
                return json.load(f_r)
            except ValueError:
                return

    def write(self, data):
        """
        Change the data.
        """
        folder = os.path.dirname(self.filename)
        if not os.path.exists(folder):
            os.mkdir(folder)
        with open(self.filename, 'w') as f_w:
            return json.dump(data, f_w)

    def purge(self):
        """
        Delete all messages.
        """
        if os.path.exists(self.filename):
            os.remove(self.filename)


class FileM(File):
    def __init__(self, filename):
        super(FileM, self).__init__(filename)
        self.data = None

    def read(self):
        return copy.deepcopy(self.data)

    def write(self, data):
        self.data = copy.deepcopy(data)

    def purge(self):
        self.data = None


class TableM(Table):
    def __init__(self, folder, write_listener=None):
        super(TableM, self).__init__(None, write_listener)
        self.data = {}

    def read(self, uid):
        return self.data.get(uid)

    def read_all(self, query=None):
        if query:
            return {k: copy.deepcopy(v) for k, v in self.data.items() if query(v)}
        return copy.deepcopy(self.data)

    def write(self, record):
        record = copy.deepcopy(record)
        uid = record.get("id")
        if not uid:
            record["id"] = uid = self.uuid()
        if self.write_listener:
            self.write_listener(record)
        self.data[uid] = record
        return uid

    def delete(self, uid):
        self.data.pop(uid, None)

    def purge(self):
        self.data.clear()


class JournalM(Journal):
    def __init__(self, filename, write_listener=None):
        super(JournalM, self).__init__(filename, write_listener)
        self.data = []

    def append(self, message):
        if self.write_listener:
            self.write_listener(message)
        self.data.append(copy.deepcopy(message))

    def read_all(self, query=None):
        out = self.data
        if query:
            out = list(filter(query, out))
        return copy.deepcopy(out)

    def purge(self):
        del self.data[:]


def mkdir_deep(folder):
    """
    Create as many paths as needed to ensure that a given folder exists.
    """
    if not folder or os.path.exists(folder):
        return
    parent = os.path.dirname(folder)
    if not os.path.exists(parent):
        mkdir_deep(parent)
    os.mkdir(folder)
