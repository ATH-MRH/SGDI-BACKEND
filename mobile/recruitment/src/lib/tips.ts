// Conseils emploi : contenu éditorial rédigé pour l'application, embarqué dans celle-ci.
// Ce ne sont pas des annonces et ils ne viennent pas du serveur de recrutement.
export type Tip = { id: string; title: string; summary: string; minutes: number; sections: { heading: string; points: string[] }[] };

export const TIPS: Tip[] = [
  {
    id: 'cv', title: 'Un CV clair en une page', minutes: 3,
    summary: 'Ce que le recruteur cherche en premier, et comment le lui montrer.',
    sections: [
      { heading: 'L’essentiel en haut', points: [
        'Nom, prénom, téléphone et wilaya de résidence sur les premières lignes.',
        'Le poste visé, écrit tel qu’il figure dans l’annonce.',
        'Votre disponibilité : immédiate, ou la date à partir de laquelle vous êtes libre.' ] },
      { heading: 'Des expériences vérifiables', points: [
        'Pour chaque poste : employeur, fonction, dates de début et de fin.',
        'Une ou deux tâches concrètes plutôt qu’une longue liste.',
        'N’indiquez que ce que vous pouvez justifier par un document ou une référence.' ] },
      { heading: 'Avant d’envoyer', points: [
        'Un seul fichier, en PDF de préférence, lisible sur un téléphone.',
        'Faites relire l’orthographe par un proche.',
        'Donnez au fichier un nom simple : CV, votre nom, votre prénom.' ] },
    ],
  },
  {
    id: 'entretien', title: 'Préparer son entretien', minutes: 4,
    summary: 'Les points à revoir la veille pour arriver serein.',
    sections: [
      { heading: 'La veille', points: [
        'Relisez l’annonce : missions, lieu de travail, horaires éventuels.',
        'Préparez vos documents : pièce d’identité, CV, diplômes et attestations.',
        'Repérez le trajet et prévoyez d’arriver dix minutes en avance.' ] },
      { heading: 'Pendant l’entretien', points: [
        'Présentez votre parcours en deux minutes, du plus récent au plus ancien.',
        'Appuyez-vous sur des situations vécues pour illustrer vos qualités.',
        'Si une question vous échappe, demandez qu’on la reformule.' ] },
      { heading: 'Vos questions', points: [
        'Le rythme de travail et l’organisation de l’équipe.',
        'La période d’essai et la formation prévue à la prise de poste.',
        'La suite du processus et le délai de réponse.' ] },
    ],
  },
  {
    id: 'candidature', title: 'Une candidature complète', minutes: 2,
    summary: 'Un dossier bien rempli est étudié plus vite.',
    sections: [
      { heading: 'Dans votre profil', points: [
        'Vérifiez votre numéro de téléphone : c’est par lui que l’on vous joint.',
        'Renseignez votre wilaya et votre commune.',
        'Ajoutez vos expériences, même courtes.' ] },
      { heading: 'Vos documents', points: [
        'Joignez un CV à jour, en PDF, JPG ou PNG, de 5 Mo au maximum.',
        'Une photo d’identité nette, de face, sur fond clair.' ] },
      { heading: 'Après l’envoi', points: [
        'Conservez la référence affichée à la confirmation.',
        'Suivez l’état de votre dossier dans l’onglet « Suivi ».',
        'Gardez votre téléphone joignable aux heures de bureau.' ] },
    ],
  },
  {
    id: 'vigilance', title: 'Postuler en toute sécurité', minutes: 2,
    summary: 'Quelques réflexes pour protéger vos informations.',
    sections: [
      { heading: 'Ce qu’un recruteur ne demande pas', points: [
        'De l’argent pour étudier un dossier ou réserver un poste.',
        'Votre code de validation reçu par SMS : il est strictement personnel.',
        'Vos mots de passe ou vos coordonnées bancaires avant une embauche.' ] },
      { heading: 'Les bons réflexes', points: [
        'Postulez depuis l’application ou auprès du service recrutement de la société.',
        'En cas de doute sur un appel ou un message, contactez directement la société.' ] },
    ],
  },
];

export const findTip = (id: string | undefined) => TIPS.find(tip => tip.id === id);
