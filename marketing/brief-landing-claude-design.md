# Brief : landing page WABAGENT (pour Claude Design)

Version du 13 nov. 2026, prix mis à jour le même jour. Remplace le brief « no-code en 48 h ».
Source de ce qui peut être promis : `docs/EVOLUTIONS.md`, section 3.

**Angle** : lancer un agent IA WhatsApp en pilote, sur son propre numéro, ouvert d'abord à des contacts choisis.
**Résultat promis** : chaque demande WhatsApp est qualifiée et arrive dans le CRM.
**Objectif** : faire demander un pilote (ou une démo).
**Cible** : PME qui veulent aller vite et juger sur pièces avant de s'engager. Dirigeant, responsable commercial ou marketing. Non techniques.
**Ton** : court, direct, peu de texte. Une idée par bloc.
**Règles** : « agent IA », jamais « agent » ni « bot » seul ; pas de tiret cadratin ni demi-cadratin ; accents complets ; on dit « pilote », jamais « POC » ni « test gratuit ».

## Ce qui change par rapport à la page en ligne

- Plus de « en ligne en 48 h » ni de « cette semaine ».
- Plus de cas d'usage e-commerce (suivi de commande, retours et échanges, livraison et paiement, disponibilité en magasin).
- Plus de « relais vers un conseiller ».
- « Prend les rendez-vous » devient « repère les demandes de rendez-vous ».
- Un seul CRM affiché comme prêt : HubSpot. Les autres passent en « Bientôt ».
- « Sans code » reste vrai mais descend au rang de preuve, hors du titre.

## Sections et textes

1. **Hero**
   - Titre : Lancez votre agent IA WhatsApp en pilote.
   - Sous-titre : Sur votre propre numéro. Ouvert d'abord aux contacts que vous choisissez, puis à tous.
   - Ligne de résultat : Chaque demande est qualifiée et arrive dans votre CRM.
   - Bouton principal : Demander un pilote
   - Bouton secondaire : Voir le back-office
   - Visuel : téléphone, conversation WhatsApp entre un contact et l'agent IA, avec à côté la fiche du lead qualifié.

2. **Le pilote en trois temps** (c'est le bloc central de la page)
   - Titre : Jugez sur de vraies conversations. Avant d'ouvrir à tous.
   - 1. Testez. Parlez à votre agent IA dans le simulateur, comme un contact.
   - 2. Ouvrez à quelques-uns. En Preview, seuls les numéros de votre Whitelist reçoivent une réponse.
   - 3. Ouvrez à tous. Passez Online quand vous êtes prêt. Offline en un clic.
   - Visuel : les pastilles Draft, Preview, Online, Offline du back-office.

3. **Ce qu'il fait**
   - Répond à vos contacts sur WhatsApp, dans vos langues, avec le ton que vous choisissez.
   - Qualifie chaque demande : nom, besoin, étape du lead.
   - Repère les demandes de rendez-vous.
   - Envoie le lead qualifié dans HubSpot.

4. **Deux façons de démarrer**
   - Titre : Seul ou accompagné. Le même produit.
   - **Pilote accompagné** : nous raccordons votre compte WhatsApp avec vous, nous réglons votre agent IA et nous faisons le bilan ensemble à la fin du pilote. Pour les équipes sans profil technique.
   - **Autonome** : vous raccordez votre compte WhatsApp, vous décrivez votre agent IA et vous l'ouvrez à votre rythme. Support par e-mail. Pour les équipes à l'aise avec Meta Business.
   - Les deux mènent au même abonnement.

5. **Sous contrôle**
   - Votre compte WhatsApp Business reste le vôtre.
   - Vos données sont isolées de celles des autres organisations.
   - Le coût de l'IA est visible, par agent IA et par jour.
   - Vous coupez quand vous voulez.

6. **Pour les équipes**
   - Plusieurs agents IA, un par numéro.
   - Plusieurs entités : points de vente, agences, services.
   - Des rôles : administrateur, manager, conseiller. Chacun voit ce qui le concerne.

7. **Intégrations**
   - Prêt : WhatsApp Business (API officielle de Meta), HubSpot.
   - Bientôt (étiquette « Soon ») : Attio, Pipedrive, Salesforce, Zoho, webhook signé.

8. **Tarifs**
   - Titre : Un pilote, puis un abonnement.
   - Trois cartes :
     - **Pilote accompagné** : 1 500 € HT, forfait unique. 6 semaines, dont 4 d'ouverture réelle. Un agent IA, raccordement de votre compte WhatsApp fait avec vous, réglage, bilan écrit. Abonnement inclus pendant le pilote.
     - **Autonome** : tarif de lancement de **190 € HT par mois et par agent IA**, pour 500 contacts par mois (soit 0,38 € HT par contact). Réservé aux dix premiers clients, garanti douze mois. Sans engagement. Au-delà du forfait : 0,50 € HT par contact. Support par e-mail. Deux mois offerts en annuel.
       - **Grille normale**, affichée à côté du tarif de lancement, avec le prix par contact sous chaque palier :
         - 200 contacts : 190 € HT par mois (0,95 € HT par contact)
         - 500 contacts : 390 € HT par mois (0,78 € HT par contact)
         - 1 000 contacts : 690 € HT par mois (0,69 € HT par contact)
         - Au-delà : sur devis
       - Le tarif de lancement et la grille normale sont tous deux par agent IA et par mois.
     - **Réseau** : à partir de 3 agents IA, plusieurs entités, sur devis.
   - Sous les cartes, trois lignes :
     - Après le pilote, vous passez à l'abonnement ou vous arrêtez. Premier mois offert si vous continuez dans les 15 jours.
     - L'IA est incluse dans l'abonnement.
     - Les messages WhatsApp sont facturés par Meta, directement sur votre compte : 1 000 réponses gratuites par numéro et par mois, puis environ 0,03 $ par réponse en France (tarif Meta au 1er octobre 2026).
   - Un contact : une personne qui échange avec l'agent IA dans le mois, quel que soit le nombre de messages.
   - **Appel vers le calculateur**, juste sous les trois cartes, sur toute la largeur, en bouton secondaire (contour, pas le remplissage menthe réservé à « Demander un pilote ») :
     - Phrase : Deux factures, aucune surprise. Estimez votre abonnement et vos messages Meta.
     - Bouton : Calculer mon coût
     - Cible : la page `/calculateur` (source : `marketing/calculateur.html`).
   - Le calculateur n'apparaît nulle part ailleurs dans le corps de la page, sauf en lien texte dans la FAQ et dans le pied de page.

9. **Preuves** : [logos ou témoignages réels ; sinon supprimer le bloc].

10. **FAQ** (réponses d'une ligne)
    - Faut-il changer de numéro ? Non, l'agent IA répond sur un numéro de votre compte WhatsApp Business.
    - Mon compte reste-t-il à moi ? Oui, il est à votre nom chez Meta et vous pouvez le débrancher.
    - Que faut-il côté Meta ? Un compte WhatsApp Business vérifié. En pilote accompagné, nous le préparons avec vous.
    - Qui reçoit des réponses pendant le pilote ? Seulement les numéros que vous avez mis dans la Whitelist.
    - Que se passe-t-il à la fin du pilote ? Un bilan sur les conversations et les leads, puis vous décidez.
    - Qui paie les messages WhatsApp ? Vous, directement à Meta. Les 1 000 premières réponses du mois sont gratuites pour chaque numéro, les suivantes coûtent environ 0,03 $ en France. Lien : Calculer mon coût.
    - L'IA est-elle facturée en plus ? Non, elle est incluse dans l'abonnement.
    - Que se passe-t-il si je dépasse mon forfait de contacts ? Rien n'est bloqué. Chaque contact au-delà du forfait coûte 0,50 € HT.
    - Quel support ? Par e-mail dans l'offre Autonome. Le pilote accompagné comprend le raccordement, le réglage et le bilan avec nous.
    - Et mon CRM ? HubSpot aujourd'hui. Les autres arrivent : dites-nous le vôtre.

11. **Appel final**
    - Titre : Votre agent IA WhatsApp, d'abord en pilote.
    - Bouton : Demander un pilote

## Charte (Émeraude et Menthe)

Référence complète : `marketing/design-reference-emeraude-menthe.html`.

- Couleurs : émeraude profond `#14322A`, émeraude `#1E463B`, menthe `#6EE7B7` (survol `#34D399`), fond `#F1F5F2`, blanc `#FFFFFF`, texte secondaire `#5C6B63`.
- Sombre : fond `#0C1A15`, surfaces `#0f251d`.
- Aucun dégradé.
- Titres en Source Serif 4, texte en Inter, détails en JetBrains Mono.
- Pastilles de statut : Draft, Preview, Online, Offline, comme dans le back-office.
- Beaucoup d'air, captures du back-office plutôt qu'illustrations.

**Livrable** : page responsive, clair et sombre, en français.

## À décider par François avant diffusion

- Prix retenus le 13 nov. 2026 :
  - Pilote accompagné : 1 500 € HT sur 6 semaines, inchangé. Le pilote n'est pas déduit de l'abonnement ; le premier mois est offert si le client continue dans les 15 jours.
  - Autonome, tarif de lancement : 190 € HT par mois et par agent IA pour 500 contacts, réservé aux dix premiers clients, garanti douze mois.
  - Autonome, grille normale : 200 contacts à 190 €, 500 à 390 €, 1 000 à 690 €, au-delà sur devis. Le prix par contact est affiché sous chaque palier.
  - Dépassement : 0,50 € HT par contact (remplace 0,20 €).
  - Support par e-mail seulement dans l'offre Autonome.
  - Un contact : une personne qui échange avec l'agent IA dans le mois.
- Points ouverts, non tranchés le 13 nov. :
  - Dépassement et grille normale. À 0,50 € le contact, le palier à 190 € plus le dépassement coûte moins cher que les paliers supérieurs : 340 € pour 500 contacts (contre 390 €), 590 € pour 1 000 contacts (contre 690 €). Personne ne prendrait les paliers à 390 € et 690 €. Pistes : dépassement à 0,50 € seulement sur le tarif de lancement, ou dépassement égal au prix par contact du palier (0,95 €, 0,78 €, 0,69 €), ou passage automatique au palier supérieur. Le texte ci-dessus applique 0,50 € partout, comme décidé. Les calculateurs retiennent le palier qui couvre les contacts, sans dépassement sur la grille normale.
  - Fin du tarif de lancement : prix à partir du 13e mois (le palier à 500 contacts de la grille est à 390 €, soit plus du double), début des douze mois, et ce qu'on appelle « client » dans « dix premiers clients ». Un compteur de places restantes n'est affiché que s'il est réel.
  - « Deux mois offerts en annuel » : repris tel quel, non traité le 13 nov. À confirmer pour le tarif de lancement et pour la grille.
- À confirmer : le coût IA réel par contact, à mesurer sur de vraies conversations (estimé entre 0,05 et 0,20 $) ; le tarif Meta, à relire sur la page de Meta avant diffusion.
- Le forfait de contacts est contractuel : le produit compte les contacts distincts par agent IA, mais pas par mois de facturation, et ne bloque rien.
- Parcours « Autonome » : tant que la plateforme n'est pas en ligne (chantier S) et que le lot R1 n'est pas mergé, la carte porte l'étiquette « Soon » et son bouton mène à la demande de pilote.

## À ne pas promettre (voir `docs/EVOLUTIONS.md`)

Délai de mise en ligne ; raccordement sans passer par Meta ; suivi de commande, Shopify, catalogue ; envoi des rendez-vous ou des commandes vers un CRM ; écran Conversations et leads ; reprise par un conseiller ; API ouverte ou marque blanche ; données traitées en Europe, conformité RGPD ; choix du modèle IA.
