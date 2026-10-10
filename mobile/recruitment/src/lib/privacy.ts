// Notice « Protection des données personnelles » affichée par l'application.
// Sa version doit être celle du serveur (PRIVACY_NOTICE_VERSION) : tout changement de fond change les deux,
// et le consentement est alors redemandé. Aucun import React Native ici : module testé par `npm test`.

export const PRIVACY_VERSION = '2026-10';
/** Marque les informations que seule la direction peut fournir : elles ne sont pas inventées. */
export const PENDING = 'À préciser par IRON GLOBAL avant la mise en service';
export const CONSENT_TEXT = 'J’accepte que mes données soient traitées par IRON GLOBAL pour la gestion de mes candidatures et du recrutement, comme l’explique la notice « Protection des données personnelles ».';

export type NoticeSection = { title: string; paragraphs?: string[]; points?: string[]; pending?: string[] };

export const PRIVACY_NOTICE: NoticeSection[] = [
  { title: 'Qui traite vos données',
    paragraphs: ['Vos données sont traitées par la société du groupe IRON GLOBAL qui publie l’annonce ou reçoit votre candidature, pour son service recrutement.'],
    pending: ['Dénomination, adresse et coordonnées du responsable du traitement', 'Coordonnées du délégué à la protection des données, s’il est désigné'] },
  { title: 'Cadre légal',
    paragraphs: ['Le traitement de vos données relève de la loi n° 18-07 du 10 juin 2018 relative à la protection des personnes physiques dans le traitement des données à caractère personnel, modifiée et complétée par la loi n° 25-11 du 24 juillet 2025.',
      'L’Autorité nationale de protection des données à caractère personnel (ANPDP) veille à l’application de cette loi. Cette application n’est ni agréée ni validée par l’ANPDP.'],
    pending: ['Référence de la formalité accomplie auprès de l’ANPDP (déclaration ou autorisation), si elle est requise'] },
  { title: 'Pourquoi vos données sont utilisées',
    points: ['Créer et sécuriser votre espace candidat, identifié par votre numéro de téléphone.', 'Étudier vos candidatures à une annonce et vos candidatures spontanées.',
      'Échanger avec vous : messages, demandes de pièces, convocations et entretiens.', 'Préparer votre embauche si votre candidature est retenue : dossier, contrat, transmission à la direction des ressources humaines.',
      'Vous prévenir des nouvelles offres, uniquement si vous activez les alertes.'],
    paragraphs: ['Vos données ne servent pas à de la prospection commerciale et ne sont pas vendues.'] },
  { title: 'Données traitées',
    points: ['Identité : nom, prénom, date et lieu de naissance, sexe, situation familiale, nombre d’enfants, noms des parents, photo.',
      'Identifiants administratifs que vous choisissez de fournir : NIN, numéro CNAS.', 'Coordonnées : téléphone, e-mail, wilaya, commune, adresse, lien et téléphone de la personne à prévenir.',
      'Parcours : poste souhaité, salaire demandé, disponibilité, service militaire, expériences, formations, compétences, langues parlées et écrites.',
      'Informations utiles à la tenue de travail : taille, pointure, taille de chemise ; groupe sanguin si vous le renseignez.',
      'Documents : CV et pièces que vous transmettez.', 'Suivi : candidatures, messages, entretiens, notifications.',
      'Données techniques : session de connexion et, si vous activez les notifications du téléphone, l’identifiant de l’appareil.'],
    paragraphs: ['Seuls le nom, le prénom et le téléphone sont nécessaires pour créer l’espace. Les autres informations sont facultatives, sauf celles qu’une candidature exige.'] },
  { title: 'Qui y a accès',
    points: ['Le service recrutement et la direction des ressources humaines des sociétés du groupe concernées par votre candidature.', 'Les prestataires techniques qui hébergent l’application, pour le seul besoin du service.'],
    pending: ['Identité et pays de l’hébergeur et des prestataires techniques', 'Existence ou non d’un transfert de données hors d’Algérie'] },
  { title: 'Durée de conservation',
    paragraphs: ['Supprimer votre espace efface votre profil, votre CV, votre photo, vos alertes et vos notifications. Les candidatures déjà transmises, avec leurs pièces et leurs échanges, restent conservées par le service recrutement pour leur traitement.'],
    pending: ['Durée de conservation des candidatures non retenues', 'Durée de conservation des dossiers des personnes recrutées', 'Durée de conservation d’un espace candidat inactif'] },
  { title: 'Vos droits',
    paragraphs: ['Vous disposez des droits prévus par la loi, notamment le droit d’être informé, le droit d’accès à vos données, le droit de les faire rectifier et le droit de vous opposer à leur traitement pour des motifs légitimes. Vous pouvez retirer votre consentement à tout moment.'],
    points: ['Dans l’application : modifier votre profil, retirer une candidature, supprimer votre espace (Profil → Paramètres).', 'Auprès du responsable du traitement, pour toute autre demande.',
      'Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l’ANPDP.'],
    pending: ['Adresse postale ou électronique à laquelle exercer vos droits'] },
  { title: 'Consentement et notifications',
    paragraphs: ['Votre consentement porte sur le traitement de vos données pour le recrutement. Il est demandé une fois, enregistré avec sa date et la version de cette notice, et redemandé seulement si la notice change.',
      'Les notifications sont un réglage séparé : vous pouvez les activer ou les couper sans effet sur ce consentement, et inversement.'] },
];

/** Informations manquantes, toutes sections confondues : tant qu'il en reste, la notice n'est pas publiable. */
export const pendingItems = () => PRIVACY_NOTICE.flatMap(section => section.pending || []);
