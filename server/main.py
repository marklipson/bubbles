"""
Back-end.
"""
import time
import hashlib
import re
import os

from server.db import Db
from server.rest import AppBase, Response, serve


class User(object):
    def __init__(self, app):
        self.app = app
        self.users = self.app.db.table("users")
        self.sessions = self.app.db.table("sessions")

    def current_session_id(self):
        rq = self.app.current.request
        if not rq:
            return
        ssn_id = rq.get("cookies", {}).get("session")
        if not ssn_id:
            return
        if not re.match('^[a-f0-9]+$', ssn_id):
            return
        return ssn_id

    def current_session(self):
        sid = self.current_session_id()
        if sid:
            return self.sessions.read(sid)

    def current_user_id(self):
        ssn = self.current_session()
        if ssn:
            return ssn.get("user")

    def current_user_rec(self):
        uid = self.current_user_id()
        if uid:
            return self.users.read(uid)

    def require_role(self, roles: (str, tuple)):
        urec = self.current_user_rec()
        if isinstance(roles, str):
            roles = (roles,)
        if not urec or urec.get("role", "") not in roles:
            raise Exception("access denied")

    def _hash_pwd(self, password: str):
        return hashlib.sha256(password.encode("utf-8")).hexdigest()[2:]

    def login(self, username: str, password: str):
        pwd_hash = self._hash_pwd(password)
        matching = self.users.read_all(lambda rec: rec.get("username") == username and rec.get("password") == pwd_hash)
        if not matching:
            return {
                "ok": False
            }
        uid = list(matching.keys())[0]
        rec = dict(matching[uid])
        rec.pop("password")
        resp = Response(content={
            "ok": True,
            "user": rec
        })
        set_ssn = {
            "user": uid,
            "t_login": time.time()
        }
        ssn = self.current_session()
        if ssn:
            # associate current session with user
            ssn.update(set_ssn)
            session_id = ssn["id"]
        else:
            # create new session for user
            session_id = self.sessions.write(set_ssn)
        # FIXME use a secure cookie (secure, httponly, or something like that)
        resp.set_cookie("session", session_id, age_s=3600*72)
        return resp

    def logout(self):
        """
        Log out user.
        """
        ssn = self.current_session()
        if ssn.get("user"):
            ssn["user"] = None
        self.sessions.write(ssn)
        return {}

    def _create_user(self, username: str, email: str=None, role: str=None):
        # prevent collision
        for urec in self.users.read_all().values():
            if urec.get("username") == username:
                return {"ok": False}
        # FIXME send password by email
        # FIXME secure random password
        # FIXME require email verification, prevent spamming
        # register new user
        password = hex(int(time.time() * 1000) % 1000000000)[2:]
        self.users.write({"username": username, "email": email, "password": self._hash_pwd(password)})
        return {"ok": True}

    def self_register(self, username: str, email: str=None):
        return self._create_user(username, email)

    def register(self, username: str, email: str=None, role: str=None):
        self.require_role("admin")
        return self._create_user(username, email, role)


class UserFiles(object):
    def __init__(self, app):
        self.app = app

    def locate(self, path: str):
        if path.startswith("/") or "/../" in path or path.startswith("../") or path.endswith("/..") or path == ".." or len(path) > 200 or len(path.split("/")) > 10:
            raise Exception("invalid file path")
        uid = self.app.user.current_user_id()
        if not uid:
            raise Exception("not logged in")
        self.app.db.file(f"files/{uid}/{path}")

    def read(self, _path: str):
        """
        Download a user's file.
        """
        # FIXME fill in mime type for download
        return Response(content=self.locate(_path).read())

    def write(self, _path: str, _data):
        """
        Store a file for a user.
        """
        # FIXME limit total number of files or total size
        if len(_data) > 1000000:
            raise Exception("too large - small files only please")
        self.locate(_path).write(_data)
        Response(content={})


class BubbleServer(AppBase):
    def __init__(self, folder: str=None, in_memory=True):
        super(BubbleServer, self).__init__()
        self.db = Db(folder, in_memory=in_memory)
        self.user = User(self)
        self.files = UserFiles(self)
        # FIXME remove 'get' for login
        self.define_endpoint(("post", "get"), "/user/login", self.user.login)
        self.define_endpoint("post", "/user/register", self.user.self_register)
        self.define_endpoint("post", "/admin/register", self.user.register)
        self.define_endpoint("post", "/user/logout", self.user.logout)
        self.define_endpoint("get", "/files/.*", self.files.read)
        self.define_endpoint("put", "/files/.*", self.files.write)
        self.static_pages("/bubbles", "../web")


if __name__ == "__main__":
    folder = os.path.expanduser("~/.bubbleserver")
    if not os.path.exists(folder):
        os.mkdir(folder)
    app = BubbleServer(folder, in_memory=False)
    print("http://localhost:2117/")
    serve(app, 2117)



"""
host bubble pages...
  hook in listeners
  receive & re-broadcast messages
    -> one master UI, others are limited
needs a simple text editor
"""