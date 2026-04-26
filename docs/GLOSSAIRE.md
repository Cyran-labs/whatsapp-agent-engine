# Glossaire Cyran Labs

**Audience** : François Greze, prep réunion MAD CRM.
**Objectif** : être à l'aise sur tous les termes employés dans le deck, les docs et la conversation lundi.

Trié par thème, lecture rapide en 15-20 min.

---

## 1. WhatsApp & Meta (l'écosystème transport)

**WhatsApp Business API** — L'API officielle de WhatsApp pour les entreprises. Distincte de WhatsApp Business (l'app gratuite pour TPE). Permet d'envoyer/recevoir des messages programmatiquement, avec templates, médias, boutons, etc.

**Meta Cloud API** — La version hébergée par Meta de l'API WhatsApp Business. Officielle, gratuite à l'usage (on paie juste les messages), accessible directement par toute entreprise vérifiée. C'est l'option "sans BSP".

**On-Premise API** — L'ancienne version self-hosted de WhatsApp Business API. En voie de dépréciation. À éviter aujourd'hui.

**WABA** — *WhatsApp Business Account*. Le compte WhatsApp Business d'une entreprise dans Meta Business Manager. Un WABA peut héberger plusieurs numéros de téléphone.

**Meta Business Manager** — La console centrale Meta où une entreprise gère ses pages Facebook, son Instagram, son WABA, ses pixels publicitaires, ses partenaires. Préalable à tout.

**Business Verification** — La procédure de vérification d'entreprise par Meta (Kbis + justificatif d'adresse + numéro pro). Prend 5 à 15 jours. Obligatoire pour faire du transactionnel.

**BSP** — *Business Service Provider*. Un partenaire officiel Meta qui revend l'accès à WhatsApp Business API. Exemples : CM.com, Twilio, 360dialog, Infobip. Apporte un confort opérationnel (onboarding rapide, templates, support) mais ajoute une marge sur chaque message.

**Solution Partner / Tech Partner Meta** — Statut officiel Meta plus large que BSP. Permet de figurer dans le directory officiel Meta et de revendre du service WhatsApp à grande échelle. Candidature à déposer.

**Template** — Un message-type pré-validé par Meta, utilisé pour initier une conversation hors fenêtre 24h. Catégories : Marketing, Utility, Authentication. Chacun a un tarif différent.

**Fenêtre 24h** — Quand un utilisateur écrit en premier au business, une fenêtre de 24h s'ouvre pendant laquelle l'entreprise peut répondre librement (gratuit côté Meta). Au-delà, il faut un template.

**Click-to-WhatsApp** — Format publicitaire Meta (Facebook/Instagram) qui ouvre directement WhatsApp avec un message pré-rempli. Étend la fenêtre à 72h.

**CTA** — *Call To Action*. Un bouton ou lien d'action dans un message (ex : "Voir le produit", "Réserver maintenant").

**Catalog Product / Product Catalog** — Le catalogue produit Meta synchronisé depuis le site marchand. Permet d'envoyer des cartes produits natives WhatsApp avec image, prix, bouton.

**Order WhatsApp** — Quand un client envoie un panier produit via le bouton catalogue WhatsApp natif. Le bot reçoit un événement `order` structuré.

---

## 2. IA & modèles LLM

**LLM** — *Large Language Model*. Modèle de langage capable de générer du texte naturel. Claude, GPT, Gemini, Mistral en sont.

**Prompt** — L'instruction qu'on envoie au modèle. Un *system prompt* définit le rôle/comportement, le *user prompt* est le message de l'utilisateur.

**Cache prompt / Prompt caching** — Mécanisme Anthropic qui mémorise les tokens du prompt système pendant 5 min. Lecture ultérieure facturée à 10% du tarif normal. Réduit les coûts de 70-90% sur les conversations longues.

**Tokens** — Unité de facturation et de mesure des LLM. ~4 caractères ou 0.75 mot par token. Coût exprimé en $/million de tokens (MTok).

**Inférence** — L'acte de faire générer une réponse par un modèle. Synonyme de "appel LLM".

**Sonnet / Haiku / Opus** — Trois tiers de modèles Anthropic. Sonnet = équilibre qualité/coût (conversation), Haiku = rapide et peu cher (extraction structurée), Opus = haut de gamme.

**Mode JSON / Structured output** — Forcer le modèle à répondre uniquement en JSON valide selon un schéma défini. Utilisé pour l'extraction de leads.

**Temperature** — Paramètre de génération (0 à 1). 0 = réponse déterministe, 1 = créative. Pour un bot transactionnel, on reste bas (0.2-0.5).

**Pluggable** — Adjectif (anglicisme) signifiant "branchable, remplaçable". Une architecture pluggable permet de remplacer un composant (modèle, transport, CRM) sans réécrire le reste.

**Agnostique** — "Indifférent à". Une architecture agnostique du transport ne sait pas si elle parle à CM.com ou Meta direct, et ça lui est égal.

---

## 3. CRM & connecteurs

**CRM** — *Customer Relationship Management*. Logiciel de gestion de la relation client. HubSpot, Salesforce, Attio, Pipedrive, MAD CRM.

**Connecteur** — Un module qui fait le pont entre deux systèmes. Ici : entre le bot et un CRM. Implémente une interface commune pour pouvoir en brancher plusieurs.

**Lead** — Un prospect identifié, avec au minimum un contact (téléphone ou email) et idéalement un contexte de besoin.

**Lifecycle Stage** (HubSpot) — Étape du parcours commercial d'un contact : Subscriber → Lead → MQL → SQL → Opportunity → Customer.

**MQL / SQL** — *Marketing Qualified Lead* / *Sales Qualified Lead*. Vocabulaire HubSpot/Salesforce pour distinguer les leads validés par le marketing vs ceux prêts pour la vente.

**Property / Field** — Un champ d'un objet CRM (firstname, email, custom_fields, etc.). HubSpot parle de "properties", Attio et Salesforce de "fields".

**Object** — Une entité CRM (Contact, Company, Deal, Note, Task). Chaque CRM a ses propres types d'objets.

**Association** — Le lien entre deux objets CRM (ex : un Contact lié à une Company). Les CRM modernes gèrent ça via des associations typées.

**Upsert** — Contraction de "update or insert". Créer si n'existe pas, mettre à jour sinon. Essentiel pour éviter les doublons en CRM.

**Idempotent** — Une opération est idempotente si la rejouer 2 fois donne le même résultat qu'une fois. Critique pour les webhooks (un retry ne doit pas créer un doublon).

**Idempotency key** — Identifiant unique d'un événement, transmis dans un header. Le serveur rejette les requêtes avec une key déjà vue. Permet le retry sans risque.

**Lead scoring** — Attribution d'un score à un lead selon sa qualité. Souvent calculé par des règles dans le CRM (HubSpot, Salesforce).

**Pipeline** — La séquence d'étapes commerciales dans un CRM (Prospection → Qualification → Proposition → Closing).

**Push (vers le CRM)** — L'action d'envoyer une donnée vers le CRM. Anglicisme courant. "On push le lead à HubSpot".

**Sync** — Synchronisation. "On sync le catalogue" = "on synchronise le catalogue".

---

## 4. Architecture logicielle

**Multi-tenant** — Une seule instance du logiciel sert plusieurs clients (tenants), avec isolation stricte des données par `client_id`. C'est ce que font HubSpot, Salesforce, Attio en backend.

**Mono-tenant** — Une instance par client. Plus lourd à opérer, mais isolation totale. Modèle "on-premise" ou "managed instance".

**Tenant** — Un client dans une architecture multi-tenant. Synonymes : workspace, organization, account.

**Stateless / Stateful** — Stateless = sans état, chaque requête est indépendante. Stateful = avec état, le serveur garde une mémoire entre les requêtes. Les connecteurs sont stateless.

**Mutex** — *Mutual exclusion*. Verrou qui garantit qu'une seule opération à la fois s'exécute pour une ressource donnée. Dans le bot, mutex par numéro de téléphone pour serializer les messages.

**Race condition** — Bug qui survient quand 2 opérations concurrentes accèdent à la même ressource. Évité par les mutex.

**Dedup / Déduplication** — Mécanisme qui rejette les messages déjà traités (par leur ID). Atomique en DB : `INSERT OR IGNORE`.

**Singleton** — Pattern de design : une seule instance d'un objet existe dans toute l'application. Utilisé pour le client Anthropic dans `llm.ts`.

**Bus d'événements / Event bus** — Système où des composants émettent des événements et d'autres les écoutent, sans se connaître directement. Découplage maximum.

**Webhook** — Une URL HTTP que le serveur appelle quand un événement se produit, en POST avec un payload JSON. Inverse du polling. Standard chez Stripe, GitHub, Calendly, et bientôt MAD CRM.

**Polling** — Le contraire d'un webhook : le client interroge le serveur à intervalle régulier "rien de nouveau ?". Inefficace, à éviter quand un webhook est possible.

**Headers (HTTP)** — Métadonnées d'une requête HTTP (Authorization, Content-Type, signatures custom). Header custom = préfixe `X-` (X-Cyran-Signature).

**Payload** — Le corps d'une requête HTTP. Pour un webhook, c'est le JSON envoyé.

**Endpoint** — Une URL de l'API qui reçoit des requêtes. `POST /api/v1/leads` est un endpoint.

**SDK** — *Software Development Kit*. Bibliothèque officielle d'un service (HubSpot SDK, Anthropic SDK) qui simplifie les appels à l'API. Optionnel, on peut toujours faire du `fetch` brut.

**RGPD** — Règlement européen sur la protection des données. Implications pratiques : opt-in explicite, droit à l'effacement, durée de conservation limitée, DPA avec les sous-traitants.

**DPA** — *Data Processing Agreement*. Contrat de sous-traitance des données personnelles. Obligatoire entre un responsable de traitement et un sous-traitant (ex : Cyran et un client).

---

## 5. Sécurité & standards web

**HMAC** — *Hash-based Message Authentication Code*. Algorithme qui produit une signature à partir d'un message + un secret partagé. Permet à un destinataire de vérifier que la requête vient bien de qui prétend l'avoir envoyée.

**HMAC SHA-256** — HMAC utilisant l'algorithme de hachage SHA-256. Standard industriel pour les webhooks signés (Stripe, GitHub, Slack...).

**Signature de webhook** — Header X-Signature contenant le HMAC du body. Le destinataire recalcule et compare. Évite que n'importe qui puisse forger des webhooks.

**Bearer token** — Format d'authentification par token. Header `Authorization: Bearer <token>`. Standard OAuth 2.0.

**API key** — Clé d'authentification simple, transmise dans un header. Moins sophistiquée qu'OAuth mais plus simple à implémenter.

**OAuth** — Standard d'autorisation où l'utilisateur permet à une app tierce d'accéder à ses données sans partager son mot de passe. Utilisé par Meta pour la connexion d'un WABA.

**Private App** (HubSpot) — Le pattern moderne HubSpot pour générer un access token dédié à une intégration. Remplace les anciennes API keys globales.

**Scope** — Périmètre d'une autorisation OAuth. "scope=crm.objects.contacts.write" autorise l'écriture sur les contacts uniquement.

**Encryption at rest** — Chiffrement des données stockées en DB. AES-256 standard. Critique pour les credentials Meta/CRM stockés par tenant.

**AES-256** — Algorithme de chiffrement symétrique. Standard pour le chiffrement de données sensibles.

---

## 6. Reliability & ops

**Retry** — Réessayer une opération qui a échoué. Standard sur les appels réseau.

**Backoff** — Stratégie d'attente entre les retries. *Backoff exponentiel* = délai qui double à chaque tentative (1s, 4s, 16s).

**Dead letter queue** (DLQ) — File de messages qui ont échoué après tous les retries. Persistés pour analyse et replay manuel. Évite de perdre des données.

**Replay** — Rejouer un événement (depuis la DLQ ou un log) pour rattraper une erreur. Possible si l'événement est idempotent.

**Rate limit** — Limite du nombre de requêtes par unité de temps imposée par une API. Anthropic, Meta, HubSpot ont leurs propres rate limits.

**RPM** — *Requests Per Minute*. Métrique courante pour les rate limits.

**Tier** (Anthropic) — Niveau d'usage chez Anthropic qui détermine les rate limits. Tier 1 = ~100 RPM, Tier 4 = >1000 RPM.

**Token bucket** — Algorithme classique de rate limiting interne : un seau de jetons qui se remplit au fil du temps, chaque requête consomme un jeton.

**4xx / 5xx** — Codes d'erreur HTTP. 4xx = erreur client (400 Bad Request, 401 Unauthorized, 404 Not Found, 429 Too Many Requests). 5xx = erreur serveur (500, 502, 503).

**429 Too Many Requests** — Réponse HTTP signalant un rate limit dépassé. À gérer avec un retry après backoff.

**Graceful shutdown** — Arrêt propre d'un serveur : finir les requêtes en cours, fermer la DB proprement, ne pas perdre de données.

**Health check** — Endpoint `/health` qui retourne 200 si le service est OK. Utilisé par Docker, Kubernetes, monitoring.

---

## 7. Stack & outils techniques

**Node.js** — Runtime JavaScript serveur. Le bot tourne dessus.

**TypeScript** — JavaScript typé. Le code source est en TS, transpilé en JS au runtime.

**Express** — Framework web minimaliste pour Node.js. Sert le webhook et le dashboard.

**Postgres / PostgreSQL** — Base de données relationnelle open source. Standard moderne pour multi-tenant.

**SQLite** — Base de données embarquée (un fichier). Utilisée actuellement dans whatsapp-cyran-bot, à migrer vers Postgres dans cyran-labs-engine.

**Docker** — Outil de containerisation. Permet de déployer le bot dans un environnement reproductible.

**VPS** — *Virtual Private Server*. Serveur loué chez OVH, Hetzner, etc. Le bot tourne sur un VPS OVH actuellement.

**Express 5** — Version récente d'Express. Mention de version utile car la 5 a des breaking changes vs la 4.

**fetch** — Fonction native JS/Node pour faire des requêtes HTTP. Remplace axios pour les cas simples.

**JSON** — *JavaScript Object Notation*. Format d'échange standard pour les API.

**Whisper** — Modèle open-source d'OpenAI pour la transcription audio (Speech-to-Text).

**Groq** — Fournisseur d'inférence ultra-rapide qui héberge Whisper. Utilisé par le bot pour transcrire les messages vocaux WhatsApp.

**STT** — *Speech-to-Text*. Transcription audio en texte.

**Calendly** — Outil de prise de RDV en ligne. Webhook envoyé à chaque RDV confirmé. Branché sur le bot acquisition Cyran.

**React Flow** — Bibliothèque React pour construire des interfaces de graphes visuels (drag & drop). Prévue pour l'éditeur de bots en P4.

---

## 8. Modèles économiques & business

**SaaS** — *Software as a Service*. Le client paie un abonnement, le logiciel tourne chez le fournisseur. Modèle dominant aujourd'hui.

**Bundle** — Package commercial qui regroupe plusieurs produits/services. "Le bot bundle dans MAD CRM" = le bot fait partie de l'offre MAD CRM.

**Embedded** — Intégré, embarqué. "Embedded SaaS" = un SaaS intégré dans un autre logiciel. Modèle où le bot tourne dans l'infra MAD CRM.

**Connected** — Connecté. "Connected SaaS" = le bot reste hébergé chez Cyran, on s'intègre via API/webhook au CRM. Plus simple que Embedded.

**BYO** — *Bring Your Own*. "BYO WABA" = le client apporte son propre compte WhatsApp Business.

**Add-on** — Module optionnel qui s'ajoute à un produit principal.

**MVP** — *Minimum Viable Product*. Version minimale d'un produit qui apporte de la valeur. La V1 du connecteur MAD CRM.

**V1** — Première version livrable. Distincte du prototype et du MVP.

**Lifecycle** — Cycle de vie. Lifecycle d'un lead, d'un produit, d'un client.

**Onboarding** — Procédure d'accueil et de mise en place d'un nouveau client/utilisateur. "Self-service onboarding" = sans intervention humaine.

**Self-service** — Service en libre-accès. Le client se débrouille via une UI sans contacter le support.

**Marketplace** — Plateforme qui regroupe plusieurs offres. Salesforce AppExchange, HubSpot Marketplace, Slack App Directory.

**OEM** — *Original Equipment Manufacturer*. Modèle où on fournit un produit qu'un autre revend sous sa marque. À éviter sauf accord cadre fort.

**Capitalistique** — Relatif au capital d'une entreprise. Une discussion capitalistique = sur la prise de parts au capital.

---

## 9. Termes spécifiques au projet

**Cyran Labs** — Nom proposé pour le moteur produit (à valider avec Marc). Pour distinguer de Cyran l'agence.

**3e entité** — La société (à créer) qui porterait l'offre produit/dev de bots, alimentée par Cyran et MAD CRM. Pas à mentionner lundi.

**Bot acquisition** — Le bot Cyran qualification leads, déjà en production. Le bot qu'on fait scanner aux invités lors des soirées, qui pousse ensuite dans Attio.

**Bot golf / immo / voyage / auto** — Les bots thématiques de la démo Cyran. À supprimer dans le nouveau dépôt portable.

**Pattern** — Façon récurrente de faire les choses, codifiée. "Le pattern Attio" = la manière dont Attio est branché qu'on va répliquer pour HubSpot et MAD CRM.

**Découplage** — Action de séparer deux composants pour qu'ils ne dépendent plus l'un de l'autre. Phase P0 du projet : découpler le moteur des thématiques de démo.

**Indispensable** — Mot-clé de la stratégie François : se rendre indispensable techniquement à Cyran via des contributions concrètes. Pas à dire à voix haute, juste à garder en tête.

---

## 10. Phrases-clés à savoir prononcer naturellement lundi

> *Le moteur est agnostique du transport, du CRM et du modèle IA.*

> *On supporte aujourd'hui CM.com en production. L'archi est prête à supporter Meta Cloud Direct via une couche d'abstraction transport. Vous choisissez votre backend WhatsApp à l'onboarding, on s'adapte.*

> *La connectivité CRM suit les standards du marché : webhooks signés HMAC SHA-256, API key par client, retry avec backoff, idempotency keys.*

> *Pour MAD CRM en V1, on utilise notre connecteur webhook générique. C'est 2-3 jours de mise en place.*

> *Trois modèles d'intégration possibles : Connecteur webhook (MVP), Bundle SaaS (module catalogue), Embedded (licence du moteur). Le choix est commercial, on s'adapte techniquement.*

> *On a Attio en production. HubSpot en cours d'intégration. Le pattern est le même pour MAD CRM.*

---

*Bonne réunion. À toi de jouer.*
