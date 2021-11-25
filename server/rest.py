"""
Standalone REST-enabling web server.
"""
import urllib.parse as urlparse
from http.server import HTTPServer, BaseHTTPRequestHandler
import re
import os
import inspect
import json
import time
import socketserver
import threading


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """ Extends the base server to handle requests in a separate thread. """


class Response(object):
    def __init__(self, content=None, mime_type: str=None, status: int=200):
        self.headers = None
        if isinstance(content, (list, dict, tuple)):
            content = json.dumps(content, indent=2)
            if not mime_type:
                mime_type = "application/json"
        self.mime_type = mime_type
        self.content = content
        self.status = status
        self.set_cookies = None

    def set_cookie(self, name: str, value: str, age_s: int=None, path: str=None):
        props = {}
        if age_s:
            props["Max-Age"] = str(age_s)
        if path:
            props["Path"] = path
        if not self.set_cookies:
            self.set_cookies = {}
        self.set_cookies[name] = (value, props)


class AppBase(object):
    """
    Base class for applications.  Call define_endpoint() to add REST endpoints.
    """
    def __init__(self):
        self.endpoints = []
        self.current = threading.local()

    def define_endpoint(self, methods, pattern, handler):
        """
        Add an endpoint.
        :param methods:         List of supported methods.
        :param pattern:         Regex string for URL pattern.
        :param handler:         Handler to call.
        """
        if not isinstance(methods, (str, list, tuple)):
            raise ValueError("Invalid method list")
        if isinstance(methods, str):
            methods = (methods,)
        else:
            methods = tuple(methods)
        if not isinstance(pattern, str):
            raise ValueError("Invalid URL pattern")
        pattern = re.compile(pattern)
        if not hasattr(handler, "__call__"):
            raise ValueError("Invalid handler")
        self.endpoints.append((methods, pattern, handler))

    def static_pages(self, url: str, files: str):
        """
        Register GET access to some files.
        """
        if not url.endswith("/"):
            url += "/"
        def handler(_path):
            if (_path.startswith(url)):
                _path = _path[len(url):]
            filename = os.path.join(files, _path.strip("/"))
            if not os.path.exists(filename):
                return
            with open(filename, 'r') as f_r:
                # FIXME fill in mime type
                return Response(content=f_r.read())
        # FIXME index.html
        self.define_endpoint("get", "^" + url + ".*$", handler)

    def log(self, msg, level="INFO"):
        print(f"{time.time():.3f}\t{level}\t{msg}")

    def create_handler(self):
        """
        Generate a handler to send HTTP requests to a REST instance.
        """
        app = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.do_all("post")

            def do_PUT(self):
                self.do_all("put")

            def do_DELETE(self):
                self.do_all("delete")

            def do_GET(self):
                self.do_all("get")

            def do_all(self, method):
                url_parts = urlparse.urlparse(self.path)
                params = parse_urlencoded(url_parts.query)
                cookies = {}
                for set_cookie in self.headers.get("Cookie", "").split(";"):
                    if "=" not in set_cookie:
                        continue
                    k, v = set_cookie.split("=")
                    cookies[k.strip()] = v
                resp = None
                try:
                    post_data = None
                    length = int(self.headers.get('content-length') or 0)
                    content_type = self.headers.get("Content-Type") or ""
                    if length and method in {"put", "post", "delete", "patch"}:
                        post_data = self.rfile.read(length)
                    if post_data and "form-urlencoded" in content_type:
                        try:
                            params.update(parse_urlencoded(post_data))
                        except:
                            # ignore
                            pass
                    for methods, pattern, handler in app.endpoints:
                        if method not in methods:
                            continue
                        if not pattern.match(url_parts.path):
                            continue
                        values = dict(
                            _method=method, _path=url_parts.path, _params=params, _data=post_data,
                            _cookies=cookies, **params
                        )
                        app.current.request = dict(
                            method=method, path=url_parts.path, params=params, data=post_data,
                            cookies=cookies
                        )
                        kwargs = adapt_args(values, handler)
                        resp = handler(**kwargs)
                        break
                except Exception as err:
                    app.log(err, level="ERROR")
                    resp = Response(status=500, content=json.dumps({"error": str(err)}))
                if resp is None:
                    resp = Response(status=404, content="Not found")
                if isinstance(resp, (dict, list, tuple)):
                    resp = Response(content=resp, mime_type="application/json")
                if not isinstance(resp, Response):
                    resp = Response(content=str(resp), mime_type="text/plain")
                self.send_response(resp.status)
                self.send_header("Content-type", resp.mime_type)
                if resp.headers:
                    for k, v in resp.headers.items():
                        self.send_header(k, v)
                if resp.set_cookies:
                    for k, v in resp.set_cookies.items():
                        props = {}
                        if isinstance(v, tuple):
                            v, props = v
                        v_set = f"{k}={v}; "
                        v_set += "; ".join(f"{k}={v}" for k, v in props.items())
                        self.send_header(f"Set-Cookie", v_set)
                self.end_headers()
                out = resp.content
                if isinstance(out, str):
                    out = out.encode("utf-8")
                self.wfile.write(out)
        return Handler


def serve(app, port: int):
    """
    Run a standalone web server.
    """
    print("STARTING WEB SERVER ON PORT %d" % port)
    # HTTPServer or ThreadedHTTPServer
    server = ThreadedHTTPServer(("0.0.0.0", port), app.create_handler())
    server.serve_forever()


def parse_urlencoded(s):
    """
    Parse jQuery's style of encoded arguments.
    """
    if isinstance(s, bytes):
        s = s.decode("utf-8", errors="ignore")
    args = urlparse.parse_qs(s)
    out = {}
    for k, v in args.items():
        if k.endswith("[]"):
            out[k[:-2]] = v
        elif len(v) == 1:
            out[k] = v[0]
        else:
            out[k] = "".join(v)
    return out


def adapt_args(supplied, method):
    kwargs = {}
    for name, spec in inspect.signature(method).parameters.items():
        if name in supplied:
            v = supplied[name]
            if spec.annotation:
                if isinstance(spec.annotation, (dict, list)):
                    v = json.loads(v)
                elif isinstance(spec.annotation, tuple):
                    # FIXME multiple types - needs clever algorithm to discern intended type
                    pass
                elif spec.annotation is not spec.empty:
                    # try instantiating, i.e. float, int, etc..
                    v = spec.annotation(v)
            kwargs[name] = v
        elif spec.default is spec.empty:
            raise ValueError(f"Missing argument: {name}")
    return kwargs

