/* Point d’entrée Administration : sous-domaines chargés ensemble, droits inchangés. */
SGDIModules.registerModule({key:"administration",routes:["admin","parametres"],dependencies:["administration-users","administration-permissions"]});
