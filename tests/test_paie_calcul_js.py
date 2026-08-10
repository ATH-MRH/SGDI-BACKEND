"""Tests chiffrés du moteur PAIE réellement exécuté dans le navigateur.

On extrait les fonctions pures du fichier livré au client et on les exécute avec
Node. Ainsi, une modification accidentelle du barème ou de la proratisation fait
échouer la CI au lieu d'altérer silencieusement les bulletins.
"""

import json
import subprocess
from pathlib import Path


JS = Path(__file__).parents[1] / "app/static/sgdi-app.js"


def _function(source: str, name: str) -> str:
    start = source.index(f"function {name}(")
    brace = source.index("{", start)
    depth = 0
    quote = None
    escaped = False
    for pos in range(brace, len(source)):
        char = source[pos]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "'\"`":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start : pos + 1]
    raise AssertionError(f"fonction JS incomplète: {name}")


def _run(expression: str):
    source = JS.read_text(encoding="utf-8")
    names = (
        "defaultPaieConfig",
        "irgBaremeMensuel",
        "irgSalaireAlgerie",
        "paiePeriodBounds",
        "paieEmploymentRatio",
    )
    program = "\n".join(_function(source, name) for name in names)
    program += "\nconst today=()=>\"2026-08-10\";\n"
    program += f"console.log(JSON.stringify({expression}));"
    result = subprocess.run(
        ["node", "-e", program], capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)


def test_irg_exoneration_et_bareme_2026():
    values = _run("[irgSalaireAlgerie(30000,defaultPaieConfig()).irg, irgBaremeMensuel(40000)]")
    assert values == [0, 4600]


def test_irg_formule_speciale_salaire():
    result = _run("irgSalaireAlgerie(34000,defaultPaieConfig())")
    assert result["irg"] >= 0
    assert "30 001 - 35 000" in result["formule"]


def test_irg_formule_handicape_retraite():
    result = _run("irgSalaireAlgerie(40000,defaultPaieConfig(),{retraite:true})")
    assert result["irg"] >= 0
    assert "handicapé / retraité" in result["formule"]


def test_proratisation_entree_en_cours_de_mois():
    ratio = _run("paieEmploymentRatio({dateRecrutement:'2026-08-16'},'2026-08')")
    assert ratio == 16 / 31


def test_periode_hors_contrat_ne_produit_pas_de_paie():
    ratio = _run("paieEmploymentRatio({dateRecrutement:'2026-09-01'},'2026-08')")
    assert ratio == 0
