# Police de l'application

L'application affiche tous ses textes en **Arial**.

| Plateforme | Police réellement affichée | Origine |
|---|---|---|
| iOS | Arial (`ArialMT`, `Arial-BoldMT`) | Fournie par le système : rien n'est embarqué. |
| Android | **Arimo** — ce n'est pas Arial | Arial n'est pas installée sur Android. Arimo (licence SIL OFL, paquet `@expo-google-fonts/arimo`) a les mêmes largeurs de caractères. |
| Aperçu web | Arial du poste | Revue d'interface uniquement. |

## Pourquoi Arial n'est pas embarquée sur Android

Arial appartient à Monotype. L'intégrer dans une application distribuée demande une licence d'intégration
(« app embedding ») : la présence du fichier sur un poste de travail ne donne pas ce droit. Aucun fichier Arial
n'est donc versionné ici.

## Pour afficher Arial sur Android

1. Obtenir la licence d'intégration auprès de Monotype (ou de son distributeur) et en garder la preuve.
2. Déposer `Arial.ttf` et `Arial-Bold.ttf` dans ce dossier.
3. Dans `src/app/_layout.tsx`, charger ces deux fichiers à la place d'Arimo ; dans `src/components/ui.tsx`,
   remplacer les deux noms Android de la constante `fonts`.

Tant que ces étapes ne sont pas faites, la police Android reste Arimo.
