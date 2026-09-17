# Rapport de migration — bascule contractuelle vers DC.IRONGS.COM

Ce document accompagne la branche `feat/dc-contractual-source`. Il ne modifie
aucune donnée et n'est **pas** un script de migration Alembic — c'est un
rapport de constat en lecture seule, à exécuter côté production par un
opérateur habilité, pour préparer la configuration DC.IRONGS.COM site par
site (aucune conversion automatique n'est effectuée : voir interdictions).

## Objectif

Lister, pour chaque site OPS actif, s'il possédait d'anciennes quotas
techniques (`equipment_plan.positionQuotas` / `groupPositionQuotas`) et s'il
dispose déjà d'un contrat DC.IRONGS.COM validé et lié. Ce rapport sert
uniquement à prioriser la configuration DC — il n'écrit rien.

## Requête en lecture seule

```sql
WITH site_legacy AS (
    SELECT
        s.id AS site_id,
        s.name AS site_name,
        s.client_id,
        s.equipment_plan -> 'positionQuotas' AS legacy_position_quotas,
        s.equipment_plan ->> 'dcContractSiteKey' AS dc_contract_site_key,
        s.equipment_plan ->> 'contractualSource' AS contractual_source
    FROM sites s
    WHERE s.active = 1
      AND (
        s.equipment_plan -> 'positionQuotas' IS NOT NULL
        OR s.equipment_plan -> 'groupPositionQuotas' IS NOT NULL
      )
)
SELECT
    sl.site_id,
    sl.site_name,
    c.id AS client_id,
    c.name AS client_name,
    c.data ->> 'dc_contract_status' AS dc_contract_status,
    sl.dc_contract_site_key,
    EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(c.data -> 'dc_contract_sites', '[]'::jsonb)) AS item
        WHERE item ->> 'key' = sl.dc_contract_site_key
    ) AS dc_mapping_present,
    sl.legacy_position_quotas AS ancien_quota_ops,
    CASE
        WHEN c.data ->> 'dc_contract_status' = 'valide'
             AND sl.dc_contract_site_key IS NOT NULL AND sl.dc_contract_site_key <> ''
             AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(c.data -> 'dc_contract_sites', '[]'::jsonb)) AS item
                WHERE item ->> 'key' = sl.dc_contract_site_key
             )
        THEN 'OK — déjà sur DC'
        ELSE 'ÉCART — à configurer dans DC.IRONGS.COM'
    END AS ecart
FROM site_legacy sl
LEFT JOIN clients c ON c.id = sl.client_id
ORDER BY ecart DESC, sl.site_name;
```

## Colonnes du rapport

| Colonne | Signification |
|---|---|
| `site_id` / `site_name` | Site OPS concerné |
| `client_id` / `client_name` | Client commercial associé (si renseigné) |
| `dc_contract_status` | `valide`, `brouillon`, ou vide (aucun contrat DC jamais soumis) |
| `dc_contract_site_key` | Clé de liaison stockée côté OPS (`equipment_plan.dcContractSiteKey`) |
| `dc_mapping_present` | `true` si cette clé correspond bien à une entrée du contrat DC |
| `ancien_quota_ops` | Les anciennes quotas techniques (conservées, jamais lues comme contractuelles depuis ce lot) |
| `ecart` | `OK` si déjà entièrement sur DC, sinon action à mener dans DC.IRONGS.COM |

## Exemple observé (item 10 du lot) — site DHL

| site_id | site_name | client_name | dc_contract_status | dc_contract_site_key | dc_mapping_present | ecart |
|---|---|---|---|---|---|---|
| 27 | DHL FORWARDING / HAMOUL 01 (40K) | DHL FORWARDING ALGERIE | *(vide)* | *(vide)* | false | ÉCART — à configurer dans DC.IRONGS.COM |

Ce site possède des `groupPositionQuotas` historiques exploitables comme point
de départ pour la saisie DC (Stock Controller, Team Leader In & Out,
Warehouse Keeper…), mais **aucune conversion automatique n'a été effectuée** —
conformément à l'interdiction explicite du lot. La configuration réelle doit
être faite manuellement depuis DC.IRONGS.COM, poste par poste, avec revue
humaine.

## Ce que ce lot NE fait PAS

- Il ne supprime aucune valeur `positionQuotas` / `groupPositionQuotas`
  existante en base (item 11).
- Il ne valide et ne publie aucun contrat DC automatiquement (aucune site,
  DHL inclus, n'est touché).
- Il ne convertit silencieusement aucune donnée OPS en contrat DC.
