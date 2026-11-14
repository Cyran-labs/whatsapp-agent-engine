# Offre et tarifs WABAGENT

Source unique de l'offre, des prix et des règles de facturation. Mis à jour le 14 nov. 2026.
Remplace `marketing/brief-landing-claude-design.md` : les textes de la landing et de la page Tarifs vivent dans le canvas Claude Design « Landing WABAGENT ».
Source de ce qui peut être promis : `docs/EVOLUTIONS.md`, section 3. Rentabilité : feuille « Rentabilité WABAGENT ». Calculateurs : `marketing/calculateur.html` (public) et `marketing/calculateur-interne.html`.

**Règles d'écriture** : « agent IA », jamais « agent » ni « bot » seul ; pas de tiret cadratin ni demi-cadratin ; accents complets ; on dit « pilote », jamais « POC » ni « test gratuit ».

## Offre et prix

- Accroche sur l'accueil, deux cartes, titre « Un pilote, puis un abonnement. » :
  - **Pilote accompagné** : sur devis, selon le périmètre du client. 6 semaines, dont 4 d'ouverture réelle.
  - **Abonnement** : à partir de 190 € HT par mois et par agent IA. Lien vers la page Tarifs.
- Page Tarifs, trois cartes :
  - **Démo** : 0 €, sans engagement. Présentation du back-office, essai dans le simulateur, revue des prérequis (compte Meta, numéro, CRM). Suite possible : pilote accompagné, sur devis.
  - **Autonome** (carte mise en avant, étiquette « Recommandé ») : un abonnement par agent IA, selon le nombre de conversations* par mois, choisi avec un curseur de 200 à 5 000, par pas de 100. L'IA est incluse. Support par e-mail. Switch Mensuel / Annuel, deux mois offerts en annuel. Sous le prix : le prix par conversation et le coût complet estimé, « IA et Meta compris ». Accordéon « Voir les + » avec les fonctionnalités par groupe. Bouton : Créer mon agent IA. Étiquette « Soon » tant que le lot O n'est pas livré.
  - **Custom** : sur devis. Au-delà de 5 000 conversations par mois, plusieurs agents IA, plusieurs entités, rôles, conditions contractuelles.
- **Grille Autonome** (validée par François le 14 nov. 2026, à revoir quand les coûts d'infrastructure et les autres charges seront connus) :
  - 200 conversations : 190 € HT par mois (0,95 € par conversation)
  - 500 conversations : 420 € HT par mois (0,84 € par conversation)
  - 1 000 conversations : 790 € HT par mois (0,79 € par conversation)
  - 2 000 conversations : 1 490 € HT par mois (0,75 € par conversation)
  - 3 000 conversations : 2 090 € HT par mois (0,70 € par conversation)
  - 5 000 conversations : 3 290 € HT par mois (0,66 € par conversation)
  - Entre deux repères, le prix suit une interpolation linéaire, arrondie à la dizaine (300 conversations : 270 € ; 400 : 340 €).
  - En annuel, dix mois facturés sur douze.
- **Offre de lancement** : 190 € HT par mois et par agent IA pour 500 conversations, au lieu de 420 €. Réservée aux dix premiers clients. Engagement de douze mois, prix garanti pendant ces douze mois, puis prix normal du plan, avec un e-mail 60 jours avant. Ne se cumule pas avec les deux mois offerts.
- **Dépassement** : rien n'est bloqué. Règle unique : chaque conversation au-delà du plan est facturée au prix par conversation du plan normal, offre de lancement comprise (0,84 € au-delà de 500 conversations).
- **Pilote accompagné** : un service sur devis, construit avec le client (parcours, CRM, volume). Format type : 6 semaines, dont 4 d'ouverture réelle, raccordement, réglage, bilan écrit, abonnement compris pendant le pilote. Premier mois d'abonnement offert si le client continue dans les 15 jours. Repère interne : jours de travail × 600 € + 5 %, arrondi à la centaine (4 jours : 2 600 € HT). Aucun montant affiché sur le site.
- \* Une conversation : les échanges entre un contact et l'agent IA, quel que soit le nombre de messages. Elle se termine 24 heures après le dernier message du contact. S'il réécrit ensuite, une nouvelle conversation est comptée. Mention en petit sous les cartes.
- Les messages WhatsApp sont facturés par Meta, directement sur le compte du client, sans marge de notre part. Le coût « IA et Meta compris » est une estimation : 8 réponses de l'agent IA par conversation, 0,0248 € par réponse au-delà de 1 000 réponses gratuites par numéro et par mois (tarif France relevé en octobre 2026, à relire avant diffusion).
- **Appel vers le calculateur**, sous les cartes de la page Tarifs, en bouton secondaire :
  - Phrase : Deux factures, aucune surprise. Estimez votre abonnement et vos messages Meta.
  - Bouton : Calculer mon coût
  - Cible : la page `/calculateur` (source : `marketing/calculateur.html`).

## Questions sur les prix (FAQ)

- Qui paie les messages WhatsApp ? Vous, directement à Meta, sans marge de notre part. Les 1 000 premières réponses du mois sont gratuites pour chaque numéro. Lien : Calculer mon coût.
- L'IA est-elle facturée en plus ? Non, elle est incluse dans l'abonnement.
- Qu'est-ce qu'une conversation ? Les échanges entre un contact et l'agent IA. Elle se termine 24 heures après le dernier message du contact.
- Que se passe-t-il si je dépasse mon plan ? Rien n'est bloqué. Chaque conversation au-delà est facturée au prix par conversation du plan normal, offre de lancement comprise.
- Que comprend le pilote accompagné ? Un service sur devis, en général six semaines, avec raccordement, réglage, bilan écrit et abonnement compris.
- Quel support ? Par e-mail dans l'offre Autonome. Le pilote accompagné comprend le raccordement, le réglage et le bilan avec nous.

## Décisions et points ouverts

- Décidé le 14 nov. 2026 :
  - Terme de facturation : la conversation (fenêtre de 24 heures après le dernier message du contact), à la place du contact.
  - Grille Autonome de 200 à 5 000 conversations ci-dessus, offre de lancement à 190 € pour 500 conversations, dépassement au prix par conversation du plan normal, offre de lancement comprise.
  - Pilote accompagné sur devis, sorti de la grille. Journée de travail comptée 600 €.
  - Meta n'est pas refacturé : le site affiche un coût complet estimé, IA et Meta compris.
  - Noms des offres : Démo, Autonome, Custom. Tarifs sur une page à part.
- Décidé le 13 nov. 2026, toujours valable :
  - Les douze mois de l'offre de lancement démarrent à la première facture de l'abonnement.
  - Dix premiers clients : tout client qui prend l'abonnement, après un pilote accompagné ou en Autonome. Une place est comptée à la première facture d'abonnement payée, pas à l'essai ni à la signature du pilote. L'offre de lancement s'ajoute au premier mois offert après un pilote. Un compteur de places restantes n'est affiché que s'il est réel.
  - Support par e-mail seulement dans l'offre Autonome.
- À revoir :
  - La grille, quand les coûts d'infrastructure et les autres charges seront connus (feuille « Rentabilité WABAGENT »).
  - Le support. Il est le vrai coût variable (1 h par client et par mois revient à 86 €, la marge du plan 200 tombe à 48 %). Piste retenue : support par e-mail automatisé par un agent IA sur n8n, à développer.
- À confirmer : le coût IA réel par conversation, à mesurer sur de vraies conversations (estimé à 0,04 €) ; le tarif Meta, à relire sur la page de Meta avant diffusion.
- Le produit ne compte pas encore les conversations par mois : comptage prévu dans le lot O.
- Parcours « Autonome » : tant que le lot O n'est pas livré, la carte porte l'étiquette « Soon » et son bouton mène à la demande de pilote. Le raccordement automatique des webhooks (lot R1) est livré et peut être annoncé.

## À ne pas promettre (voir `docs/EVOLUTIONS.md`)

Délai de mise en ligne ; raccordement sans passer par Meta ; suivi de commande, Shopify, catalogue ; envoi des rendez-vous ou des commandes vers un CRM ; écran Conversations et leads ; reprise par un conseiller ; API ouverte ou marque blanche ; données traitées en Europe, conformité RGPD ; choix du modèle IA.
