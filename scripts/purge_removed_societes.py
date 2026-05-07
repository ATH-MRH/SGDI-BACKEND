from app.db.session import SessionLocal
from app.modules.irongs.models import IrongsCollection


REMOVED = {
    "SWORD CORPORATION",
    "IRON GLOBAL SOLUTION",
    "SWORD CONSTRUCTION",
    "IRON GLOBAL SECURITE",
}


def norm(value: object) -> str:
    return " ".join(str(value or "").split()).upper()


def main() -> None:
    db = SessionLocal()
    changed = 0
    try:
        rows = db.query(IrongsCollection).all()
        rowmap = {row.name: row for row in rows}
        articles = rowmap.get("stockArticles")
        article_data = articles.data if articles and isinstance(articles.data, list) else []
        stock_ids = {
            item.get("id")
            for item in article_data
            if isinstance(item, dict) and norm(item.get("societe")) in REMOVED
        }
        collections_with_societe = {
            "agents",
            "candidats",
            "sites",
            "materiel",
            "stockArticles",
            "magasins",
            "fournisseurs",
            "clients",
            "prospects",
            "opportunites",
            "visites",
            "catalogue",
            "devis",
            "factures",
            "paiements",
            "avances",
            "avoirs",
            "caisse",
            "incidents",
            "pointages",
            "feuillePresence",
        }

        for row in rows:
            data = row.data
            if row.name in collections_with_societe and isinstance(data, list):
                before = len(data)
                row.data = [
                    item
                    for item in data
                    if not (isinstance(item, dict) and norm(item.get("societe")) in REMOVED)
                ]
                changed += before - len(row.data)

            if row.name == "stockMouvements" and isinstance(data, list):
                before = len(data)
                row.data = [
                    item
                    for item in data
                    if not (
                        isinstance(item, dict)
                        and (norm(item.get("societe")) in REMOVED or item.get("articleId") in stock_ids)
                    )
                ]
                changed += before - len(row.data)

            if row.name == "users" and isinstance(data, list):
                for user in data:
                    allowed = user.get("societesAutorisees") if isinstance(user, dict) else None
                    if isinstance(allowed, list):
                        before = len(allowed)
                        user["societesAutorisees"] = [name for name in allowed if norm(name) not in REMOVED]
                        changed += before - len(user["societesAutorisees"])

            if row.name == "societesConfig" and isinstance(data, dict):
                if isinstance(data.get("custom"), list):
                    before = len(data["custom"])
                    data["custom"] = [name for name in data["custom"] if norm(name) not in REMOVED]
                    changed += before - len(data["custom"])
                for key in ("images", "descriptions"):
                    if isinstance(data.get(key), dict):
                        for name in list(data[key].keys()):
                            if norm(name) in REMOVED:
                                del data[key][name]
                                changed += 1
                data["removed"] = sorted(REMOVED)
                row.data = data

        db.commit()
        print(f"purged entries: {changed}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
