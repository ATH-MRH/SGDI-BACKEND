"""Catalogue canonique du futur moteur de permissions granulaires.

Ce module ne branche aucune règle sur les endpoints existants. Il fournit
uniquement les identifiants stables acceptés par le stockage du lot 0.5-A.
"""

CANONICAL_MODULES: tuple[str, ...] = (
    "administration",
    "drh",
    "recruitment",
    "leaves",
    "ops",
    "attendance",
    "material",
    "commercial",
    "sales",
    "purchases",
    "accounting",
    "finance",
    "reporting",
    "loans",
    "secretariat",
    "cash",
    "employee_portal",
    "client_portal",
    "rounds",
    "assistant",
    "erp_cockpit",
    "legacy",
    "ui",
)

CANONICAL_ACTIONS: tuple[str, ...] = (
    "read",
    "create",
    "update",
    "validate",
    "delete",
    "export",
    "unlock",
    "admin",
    "sign",
    "pay",
    "recruit",
    "execute",
)

CANONICAL_MODULE_SET = frozenset(CANONICAL_MODULES)
CANONICAL_ACTION_SET = frozenset(CANONICAL_ACTIONS)


# Catalogue préparatoire fondé sur les routeurs backend et les rubriques frontend
# existants. Il reste sans effet sur l'autorisation des endpoints métier.
FEATURE_CATALOG: dict[str, dict] = {
    "administration": {"label": "Administration", "domain": "atlas.irongs.com", "description": "Identités, accès et configuration système", "features": {
        "users": ("Utilisateurs", "Comptes et profils utilisateurs", ("read", "create", "update", "delete", "unlock", "admin")),
        "access_rules": ("Droits d’accès", "Règles d’accès legacy", ("read", "update", "admin")),
        "security": ("Sécurité des accès", "Contrôles et maintenance de sécurité", ("read", "update", "unlock", "admin")),
    }},
    "drh": {"label": "DRH", "domain": "drh.irongs.com", "description": "Gestion des ressources humaines", "features": {
        "dashboard": ("Tableau de bord", "Indicateurs RH", ("read", "export")),
        "employees": ("Employés", "Gestion des fiches employés", ("read", "create", "update", "delete", "export")),
        "positions": ("Postes", "Référentiel des fonctions et postes", ("read", "create", "update", "delete", "admin")),
        "position_files": ("Fiches de position", "Carrière et position des employés", ("read", "export")),
        "contracts": ("Contrats", "Contrats de travail", ("read", "create", "update", "delete", "export", "sign")),
        "sanctions": ("Sanctions", "Sanctions disciplinaires", ("read", "create", "validate")),
        "documents": ("Documents RH", "Documents et attestations", ("read", "create", "delete", "export")),
        "contract_templates": ("Modèles contractuels", "Modèles, clauses et contrats générés", ("read", "create", "update", "delete", "export", "admin")),
    }},
    "recruitment": {"label": "Recrutement", "domain": "recrute.irongs.com", "description": "Candidatures et contractualisation", "features": {
        "candidates": ("Candidats", "Dossiers de candidature", ("read", "create", "update", "validate", "delete", "recruit")),
        "contact_duplicates": ("Doublons de contact", "Contrôle des coordonnées candidates", ("read",)),
        "convocations": ("Convocations", "Envoi des convocations", ("create", "execute")),
        "contractualization": ("Contractualisation", "Transmission vers le dossier contractuel", ("update", "validate", "recruit")),
    }},
    "leaves": {"label": "Congés", "domain": "drh.irongs.com", "description": "Demandes et décisions de congé", "features": {
        "requests": ("Demandes de congé", "Création, consultation et décision", ("read", "create", "validate")),
    }},
    "ops": {"label": "Opérations", "domain": "ops.irongs.com", "description": "Exploitation et supervision opérationnelle", "features": {
        "dashboard": ("Tableau de bord", "Indicateurs opérationnels", ("read", "export")),
        "rotations": ("Rotations", "Modèles et affectation des rotations", ("read", "create", "update", "delete")),
        "sites": ("Sites", "Gestion des sites opérationnels", ("read", "create", "update", "delete")),
        "site_posts": ("Postes de site", "Effectifs contractuels par fonction", ("read", "create")),
        "assignments": ("Affectations", "Affectations des employés", ("read", "create", "update")),
        "events": ("Incidents et événements", "Main courante opérationnelle", ("read", "create", "validate")),
        "movements": ("Mouvements", "Mouvements opérationnels", ("read", "create", "execute")),
    }},
    "attendance": {"label": "Pointage", "domain": "pointage.irongs.com", "description": "Présences, absences et pointage", "features": {
        "daily_sheets": ("Feuilles quotidiennes", "Pointages et états journaliers", ("read", "create", "update", "validate")),
        "generation": ("Génération et clôture", "Génération par rotation et clôture", ("validate", "execute")),
        "qr_scanning": ("Pointage QR", "Lecture et validation QR", ("read", "create", "execute")),
        "manual_entry": ("Saisie manuelle", "Recherche et saisie par le pointeur", ("read", "create")),
        "staffing": ("Effectifs par shift", "Effectifs contractuels et présence", ("read", "export")),
        "statistics": ("Statistiques et alertes", "Indicateurs et anomalies de pointage", ("read", "export")),
    }},
    "material": {"label": "Matériel", "domain": "materiel.irongs.com", "description": "Équipements, stocks et dotations", "features": {
        "dashboard": ("Tableau de bord", "Indicateurs et alertes matériel", ("read",)),
        "stores": ("Magasins", "Gestion des magasins", ("read", "create", "update", "delete")),
        "suppliers": ("Fournisseurs", "Fournisseurs du module matériel", ("read", "create", "update", "delete")),
        "articles": ("Articles", "Catalogue des articles", ("read", "create", "update", "delete")),
        "inventory": ("Inventaire", "État des stocks", ("read", "export")),
        "movements": ("Mouvements", "Entrées, sorties et transferts", ("read", "create", "delete")),
        "allocations": ("Dotations", "Dotations et reversements", ("read", "create", "update", "execute")),
        "initialization": ("Initialisation", "Dotation initiale administrative", ("admin", "execute")),
    }},
    "commercial": {"label": "Commercial", "domain": "dc.irongs.com", "description": "Clients et paramétrage commercial", "features": {
        "clients": ("Clients", "Référentiel et dossiers clients", ("read", "create", "update", "delete")),
        "settings": ("Paramètres DC", "Configuration commerciale", ("read", "update", "admin")),
        "access_rules": ("Règles DC", "Accès au domaine commercial", ("read", "update", "admin")),
        "client_contracts": ("Contrats client", "Informations contractuelles client", ("read", "update", "sign")),
    }},
    "sales": {"label": "Ventes / Facturation", "domain": "fac.irongs.com", "description": "Cycle de vente client", "features": {
        "quotes": ("Devis", "Création et validation des devis", ("read", "create", "update", "validate", "delete", "export")),
        "orders": ("Commandes clients", "Commandes et lignes de commande", ("read", "create", "update", "delete", "export")),
        "deliveries": ("Livraisons", "Bons et lignes de livraison", ("read", "create", "update", "delete", "execute")),
    }},
    "purchases": {"label": "Achats", "domain": "purchases.irongs.com", "description": "Achats et fournisseurs", "features": {
        "suppliers": ("Fournisseurs", "Référentiel fournisseurs", ("read", "create", "update", "delete", "export")),
        "orders": ("Commandes fournisseurs", "Bons de commande et lignes", ("read", "create", "update", "validate", "delete", "export")),
        "receipts": ("Réceptions", "Réceptions et lignes", ("read", "create", "update", "validate", "delete", "execute")),
        "invoices": ("Factures fournisseurs", "Factures et paiements", ("read", "create", "update", "pay", "export")),
    }},
    "accounting": {"label": "Comptabilité", "domain": "finances.irongs.com", "description": "Comptes, écritures et balance", "features": {
        "accounts": ("Comptes", "Plan comptable", ("read", "create", "update", "delete")),
        "entries": ("Écritures", "Écritures comptables", ("read", "create", "update", "validate", "delete")),
        "entry_lines": ("Lignes d’écriture", "Détail des écritures", ("create", "update", "delete")),
        "balance": ("Balance", "Balance comptable", ("read", "export")),
    }},
    "finance": {"label": "Finance", "domain": "finances.irongs.com", "description": "Données financières et paie exposées", "features": {
        "entries": ("Données financières", "Collections financières autorisées", ("read", "export")),
        "payroll": ("Données de paie", "Collections de paie autorisées", ("read", "export")),
    }},
    "reporting": {"label": "Reporting", "domain": "atlas.irongs.com", "description": "Indicateurs consolidés", "features": {
        "dashboard": ("Tableau de bord", "Synthèse consolidée", ("read", "export")),
        "sales": ("Ventes", "Indicateurs de vente", ("read", "export")),
        "purchases": ("Achats", "Indicateurs d’achat", ("read", "export")),
        "treasury": ("Trésorerie", "Indicateurs de trésorerie", ("read", "export")),
        "rankings": ("Classements", "Top clients et fournisseurs", ("read", "export")),
    }},
    "loans": {"label": "Prêts et avances", "domain": "pret.irongs.com", "description": "Demandes, décisions et remboursements", "features": {
        "employee_requests": ("Demandes salarié", "Profil, simulation et demandes", ("read", "create", "update", "delete")),
        "review": ("Instruction", "Étude et avis de gestion", ("read", "update", "validate")),
        "decisions": ("Décisions", "Décision DG et document", ("read", "validate", "sign", "export")),
        "contracts": ("Contrats", "Contrat bénéficiaire", ("read", "sign", "export")),
        "secretariat": ("Suivi secrétariat", "Signature du bénéficiaire", ("read", "validate")),
        "disbursements": ("Décaissements", "Mise à disposition des fonds", ("pay",)),
        "repayments": ("Remboursements", "Échéances et remboursements", ("read", "create", "pay")),
        "settings": ("Paramètres", "Configuration prêts et avances", ("read", "update", "admin")),
    }},
    "secretariat": {"label": "Secrétariat Général", "domain": "sg.irongs.com", "description": "Circulation et archivage documentaire", "features": {
        "mail": ("Courrier", "Courriers entrants et sortants", ("read", "create", "update", "validate", "export")),
        "signature_book": ("Parapheur", "Documents soumis à signature", ("read", "validate", "sign")),
        "missions": ("Ordres de mission", "Ordres de mission", ("read", "create", "update", "validate", "sign", "export")),
        "agenda": ("Agenda", "Agenda du secrétariat", ("read", "create", "update", "delete")),
        "minutes": ("Réunions et PV", "Réunions et procès-verbaux", ("read", "create", "update", "sign", "export")),
        "decisions": ("Décisions", "Décisions officielles", ("read", "create", "validate", "sign", "export")),
        "documents": ("Documents officiels", "Documents et modèles officiels", ("read", "create", "update", "delete", "export")),
        "messaging": ("Messagerie", "Échanges internes", ("read", "create")),
        "archives": ("Archives", "Archives et historique", ("read", "export", "admin")),
    }},
    "cash": {"label": "Caisse", "domain": "caisse.irongs.com", "description": "Encaissements et décaissements", "features": {
        "transactions": ("Mouvements de caisse", "Encaissements et décaissements", ("read", "create", "update", "pay", "export")),
        "loan_disbursements": ("Décaissements de prêts", "Prêts à décaisser", ("read", "pay")),
        "loan_repayments": ("Remboursements", "Remboursements de prêts et avances", ("read", "create", "pay")),
    }},
    "employee_portal": {"label": "Portail RH", "domain": "portail-rh.irongs.com", "description": "Services en ligne des employés", "features": {
        "accounts": ("Comptes employés", "Création et gestion des comptes", ("read", "create", "update", "delete", "unlock", "admin")),
        "requests": ("Demandes", "Demandes des employés", ("read", "create")),
        "attendance": ("Pointages", "Consultation et saisie des pointages", ("read", "create")),
        "passwords": ("Mot de passe", "Réinitialisation et changement", ("update", "unlock")),
        "notifications": ("Notifications push", "Abonnements et notifications", ("read", "create", "delete", "execute")),
    }},
    "client_portal": {"label": "Portail client", "domain": "client.irongs.com", "description": "Espace opérationnel des clients", "features": {
        "employees": ("Employés", "Personnel visible et groupes", ("read", "update")),
        "sites": ("Sites", "Sites et groupes du client", ("read", "create", "update", "delete")),
        "equipment": ("Équipements", "Catalogue et équipements", ("read", "create")),
        "observations": ("Observations", "Observations et demandes d’action", ("read", "create", "validate")),
        "accounts": ("Comptes portail", "Utilisateurs du portail client", ("read", "create", "update", "delete", "unlock", "admin")),
    }},
    "rounds": {"label": "Rondes", "domain": "ronde.irongs.com", "description": "Circuits et exécution des rondes", "features": {
        "circuits": ("Circuits", "Configuration des circuits", ("read", "create", "update", "delete")),
        "checkpoints": ("Points de contrôle", "Points composant les circuits", ("create", "update", "delete")),
        "executions": ("Exécutions", "Démarrage, scans et clôture", ("read", "execute")),
    }},
    "assistant": {"label": "Assistant IA", "domain": "atlas.irongs.com", "description": "Conversation et actions assistées", "features": {
        "chat": ("Conversation", "Dialogue avec l’assistant", ("create", "execute")),
        "agent": ("Agent d’action", "Exécution assistée contrôlée", ("execute",)),
        "speech": ("Synthèse vocale", "Restitution vocale", ("read",)),
    }},
    "erp_cockpit": {"label": "Cockpit ERP", "domain": "atlas.irongs.com", "description": "Préparation et vision opérationnelle", "features": {
        "operational_preparation": ("Préparation opérationnelle", "Agrégats de préparation", ("read", "export")),
    }},
    "legacy": {"label": "Socle legacy", "domain": "atlas.irongs.com", "description": "Collections historiques partagées", "features": {
        "database": ("Base partagée", "Instantané de la base legacy", ("read", "create", "update", "admin")),
        "collections": ("Collections", "Collections et éléments legacy", ("read", "create", "update", "delete")),
        "positions": ("Postes legacy", "Référentiel historique des postes", ("read", "create", "delete")),
        "generic_actions": ("Actions génériques", "Actions legacy explicitement nommées", ("validate", "execute")),
    }},
    "ui": {"label": "Interface", "domain": "atlas.irongs.com", "description": "Navigation et indicateurs d’interface", "features": {
        "sidebar_stats": ("Indicateurs latéraux", "Compteurs de navigation", ("read",)),
        "app_launcher": ("Lanceur d’applications", "Ouverture des applications autorisées", ("execute",)),
    }},
}

CANONICAL_FEATURE_PAIRS = frozenset(
    (module_key, feature_key)
    for module_key, module in FEATURE_CATALOG.items()
    for feature_key in module["features"]
)


def is_canonical_feature(module_key: str, feature_key: str) -> bool:
    return (module_key, feature_key) in CANONICAL_FEATURE_PAIRS


def applicable_actions(module_key: str, feature_key: str) -> tuple[str, ...]:
    feature = FEATURE_CATALOG.get(module_key, {}).get("features", {}).get(feature_key)
    return feature[2] if feature else ()


def feature_catalog_payload() -> dict:
    return {
        "modules": [
            {
                "module_key": module_key,
                "label": module["label"],
                "domain": module["domain"],
                "description": module["description"],
                "features": [
                    {
                        "feature_key": feature_key,
                        "label": feature[0],
                        "description": feature[1],
                        "applicable_actions": list(feature[2]),
                    }
                    for feature_key, feature in module["features"].items()
                ],
            }
            for module_key, module in FEATURE_CATALOG.items()
        ],
        "actions": list(CANONICAL_ACTIONS),
        "granular_permissions_active": False,
    }


def is_canonical_module(value: str) -> bool:
    return value in CANONICAL_MODULE_SET


def is_canonical_action(value: str) -> bool:
    return value in CANONICAL_ACTION_SET
