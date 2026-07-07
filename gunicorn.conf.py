import os

workers = int(os.environ.get("WEB_CONCURRENCY", 4))
worker_class = "uvicorn.workers.UvicornWorker"
bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
proxy_headers = True
forwarded_allow_ips = "*"
timeout = 120
keepalive = 5
preload_app = False


def post_fork(server, worker):
    # Chaque worker reçoit un identifiant unique.
    # Le scheduler email n'est activé que dans le worker 1.
    os.environ["GUNICORN_WORKER_ID"] = str(worker.age)
