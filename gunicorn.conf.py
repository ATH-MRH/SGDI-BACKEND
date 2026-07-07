import os

# Défaut prudent : chaque worker charge toute l'app en mémoire. Sur un petit serveur
# ou un VPS partagé, trop de workers sature la RAM et ralentit tout. Augmentez
# WEB_CONCURRENCY sur une machine dédiée bien dotée.
workers = int(os.environ.get("WEB_CONCURRENCY", 2))
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
