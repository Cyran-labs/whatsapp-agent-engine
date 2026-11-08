# Audit ciblé de la zone du plan 2b (8 nov. 2026)

Audit en lecture seule de `main` (f5033ad) avant la spec du plan 2b (Connexions WhatsApp). Trois zones : réception et envoi des messages, routage et sessions, identifiants et activation. Chaque constat bloquant a été revérifié dans le code après les agents d'audit. Les numéros de ligne sont ceux de f5033ad.

Légende : **B** bloquant pour la production, **I** important, **M** mineur. « Réglé par la refonte » signifie que le modèle cible du 2b (comptes WhatsApp d'organisation, inventaire, un numéro par agent IA, routage par `phone_number_id`) supprime le défaut à condition de le traiter explicitement.

## 1. Fuites entre organisations

| # | Grav. | Constat | Où | Traitement 2b |
|---|---|---|---|---|
| 1.1 | B | Session clée par le seul téléphone du contact (`sessions.phone` PK) et consultée avant le numéro destinataire. Un contact qui a parlé à l'organisation A puis écrit au numéro de B est routé vers A : avec une app Meta partagée, A répond depuis son numéro et capte le prospect de B ; avec des apps distinctes, HMAC rejeté, message de B perdu ; avec des transports différents, message ignoré. La session ne se corrige jamais (pas d'expiration). | `src/core/router.ts:22-31`, `sqlite.ts:60`, `postgres.ts:15`, `index.ts:83-109` | Routage par numéro destinataire d'abord ; session clée (numéro WhatsApp, contact) |
| 1.2 | B | Historique « cross-bot » : les 10 derniers messages du contact avec tout autre agent IA, y compris d'autres organisations, sont injectés dans le prompt (`NOT (client_id = ? AND bot_id = ?)`). Le LLM et l'extracteur de leads de B peuvent restituer des données échangées avec A. Problème RGPD. | `handler.ts:448-457`, `sqlite.ts:343`, `postgres.ts:308` | Supprimer |
| 1.3 | B | Commandes de contrôle WhatsApp : `ADMIN_PHONES` global ; `/sessions`, `/leads`, `/bots` listent toutes les organisations ; `/reset` appelle `resetAll` (efface sessions, conversations, leads du contact dans toutes les organisations). `/reset +33…` n'efface rien (format) mais répond « effacée ». | `admin.ts:17-124`, `config.ts:62` | Supprimer les commandes admin (le back-office les remplace) |
| 1.4 | I | `/dashboard` (clé globale `DASHBOARD_API_KEY`) renvoie les leads de toutes les organisations. | `index.ts:190-206` | Supprimer (l'API admin scopée le remplace) |
| 1.5 | B | Numéro saisi en texte libre, sans lien avec le `phone_number_id` des identifiants : une organisation peut revendiquer le numéro d'une autre ; avec une app partagée, elle capte ses messages. | `bot-service.ts:173-187`, `meta-cloud.ts:328-331` | Réglé par la refonte (numéro tiré de l'inventaire validé) |

## 2. Repli sur les identifiants de la plateforme

| # | Grav. | Constat | Où | Traitement 2b |
|---|---|---|---|---|
| 2.1 | B | Agent IA sans identifiants : repli complet sur `META_*` / `CM_*` du `.env`. Un brouillon d'une organisation répond avec le numéro et le jeton de la plateforme, et vérifie le HMAC avec le secret plateforme. | `transport/index.ts:49-74`, `cm-com.ts:68-70` | Aucun repli `.env` pour un agent IA d'organisation (fail closed) |
| 2.2 | B | Repli champ par champ CM.com (`??` vers config) et `service_url` libre : un admin d'organisation peut faire envoyer le `CM_PRODUCT_TOKEN` de la plateforme vers une URL qu'il choisit (fuite de jeton, SSRF aveugle). Aucun champ requis à l'enregistrement. | `cm-com.ts:68-70, 95-99`, `credentials-service.ts:14-22` | Champs requis par mode, `service_url` non saisissable |
| 2.3 | B | Le parseur de webhook Meta instancie un transport avec les `META_*` globaux : sans eux, chaque POST lève une exception (après le 200) et aucun message Meta n'est traité. | `transport/index.ts:22-41`, `meta-cloud.ts:79-83`, `index.ts:79` | Parseur pur, sans identifiants |

## 3. Statuts et règle d'activation

| # | Grav. | Constat | Où | Traitement 2b |
|---|---|---|---|---|
| 3.1 | B | Le statut de l'agent IA n'est pas lu à l'exécution (`BotConfig` n'a pas de `status`) : brouillon et pause répondent. Une organisation suspendue continue de répondre. La règle d'activation n'est contrôlée qu'au passage à `active`. | `bot-config.ts:8-35`, `config-store.ts:26-79`, `router.ts`, `bot-service.ts:154-171` | Filtre au routage : statut agent IA, statut organisation, liste d'accès limité |
| 3.2 | I | Changer le transport par PATCH, changer les numéros d'un agent actif, ou changer ses identifiants ne réinitialise pas tout : l'agent reste `active` avec une validation nulle ou périmée. | `bot-service.ts:133, 154-187`, `connections-service.ts:33-38`, `contracts/src/bots.ts:39` | Réglé par la refonte si les changements passent par le compte WhatsApp et suspendent l'agent |
| 3.3 | I | Course entre validation et changement d'identifiants : la validation peut marquer valides des identifiants qu'elle n'a pas testés. | `connections-service.ts:47-68` | Empreinte des identifiants validés |
| 3.4 | I | Validation Meta minimale : `GET {phone_number_id}?fields=id`. Ni comparaison du numéro, ni test du secret d'app (un secret faux rend l'agent muet après activation), ni abonnement webhook, ni timeout. CM.com : présence des champs seulement. | `meta-cloud.ts:423-434`, `cm-com.ts:356-362` | Validation complète du compte (voir spec) |
| 3.5 | M | Aucune machine d'états des statuts (`paused` vers `draft` accepté, etc.). | `bot-service.ts:154-171` | Machine d'états explicite |

## 4. Sécurité des webhooks

| # | Grav. | Constat | Où | Traitement 2b |
|---|---|---|---|---|
| 4.1 | B | Webhooks CM.com (`/webhook/cm-com` et `/webhook` legacy) sans aucune authentification : faux messages, appels LLM facturés, envois depuis le numéro d'une organisation, faux leads poussés au CRM. | `index.ts:157-168`, `cm-com.ts` | Secret par compte dans l'URL, comparaison à temps constant ; suppression de `/webhook` |
| 4.2 | I | HMAC Meta sauté si `rawBody` est absent (fail-open conditionnel ; non exploitable aujourd'hui d'après le comportement supposé d'express.json). | `index.ts:96` | Refuser sans corps brut ; HMAC sur le Buffer |
| 4.3 | M | GET de vérification : jeton vide accepté si `META_VERIFY_TOKEN` absent, challenge reflété ; GET legacy toujours 200. | `index.ts:44-46, 169-175` | Jeton par compte, refus si vide, `text/plain` |

## 5. Fiabilité de traitement des messages

| # | Grav. | Constat | Où | Traitement 2b |
|---|---|---|---|---|
| 5.1 | I | Seul `entry[0].changes[0].messages[0]` est lu : un POST groupé perd des messages ; `statuses`, `account_update`, qualité ignorés. | `meta-cloud.ts:322-331` | Itérer ; traiter statuses et account_update |
| 5.2 | I | Types Meta ignorés en silence (`button` de template, sticker, location, reaction, unsupported) : pas de réponse, pas de journal. | `meta-cloud.ts:338-390` | Réponse explicite et journal |
| 5.3 | I | Dédoublonnage Postgres non atomique (SELECT puis INSERT) : double appel LLM et double réponse sur relivraison concurrente. SQLite est atomique, d'où un défaut invisible en dev. | `postgres.ts:403-415` | `INSERT … ON CONFLICT DO NOTHING RETURNING` |
| 5.4 | I | `saveLead` Postgres en lecture puis écriture : mises à jour perdues, erreur d'unicité au premier insert concurrent. | `postgres.ts:325-346` | Upsert atomique avec fusion JSON |
| 5.5 | I | Livraison au plus une fois : 200 immédiat, message marqué traité avant la réponse, arrêt brutal sans attente des traitements en cours. | `index.ts:76, 113, 214-217` | Marquer traité après envoi ; arrêt propre. Inbox persistante : différée (audit complet) |
| 5.6 | I | Premier message d'un nouveau contact perdu quand l'accueil est actif (seul « [Welcome] » est stocké) ; deux premiers messages simultanés : deux accueils, deux messages perdus. | `index.ts:106-141`, `handler.ts:510-532` | Traiter le premier message après l'accueil, sous verrou |
| 5.7 | I | Mutex par téléphone seul, en mémoire, qui ne couvre ni le routage, ni la création de session, ni l'extraction de lead. | `index.ts:57-68`, `handler.ts:499` | Clé (numéro WhatsApp, contact), périmètre élargi. Verrou partagé : différé (multi-instance) |
| 5.8 | I | Cache des transports par agent IA jamais invalidé : jeton renouvelé ou secret changé ignorés jusqu'au redémarrage ; un transport `.env` mis en cache avant configuration reste utilisé. | `transport/index.ts:20, 43-80` | Cache par compte WhatsApp, invalidé à chaque changement |
| 5.9 | I | Erreurs d'envoi Meta non classées : jeton expiré (190/401) et fenêtre 24 h (131047) seulement journalisés ; 5xx réessayé sans idempotence ; erreur réseau non réessayée. | `meta-cloud.ts:94-122` | Classement des erreurs, état du compte mis à jour |
| 5.10 | I | Mot-clé « reset » : tout contact efface sa conversation et son lead (le lead reste au CRM, doublon possible ensuite). | `admin.ts:41-44` | Réservé aux numéros de la liste d'accès limité |
| 5.11 | I | CrmBridge câblé une seule fois au démarrage : un agent IA créé ou configuré ensuite ne pousse pas ses leads avant redémarrage. | `crm-bridge.ts:35-74` | Hors 2b (plan CRM), à noter |
| 5.12 | M | ID de repli `Date.now()` : dédoublonnage inopérant ou faux doublons. | `cm-com.ts:296`, `meta-cloud.ts:332` | `randomUUID` ou refus |
| 5.13 | M | Messages anciens relivrés traités comme neufs (timestamp calculé, jamais utilisé). | `meta-cloud.ts:333-335` | Seuil d'ancienneté |
| 5.14 | M | Version Graph `v22.0` en dur (expire le 20 mai 2027). | `meta-cloud.ts:13` | Constante de configuration unique |
| 5.15 | M | Aucun test du chemin webhook (HMAC, parse, routage, verrou). | `src/transport/__tests__` | Tests à écrire dans le 2b |

## 6. Données et concurrence

| # | Grav. | Constat | Où | Traitement 2b |
|---|---|---|---|---|
| 6.1 | I | Normalisation des numéros incohérente entre back-office (chiffres seuls) et transports (retrait de `00`) : `0033…` ou `06…` jamais routés, unicité contournable par le format, doublon dans la requête en 500. | `bot-service.ts:13-15`, `config-store.ts:18`, `meta-cloud.ts:19-23`, `cm-com.ts:22-25` | Une normalisation E.164 partagée ; Meta routé par `phone_number_id` |
| 6.2 | I | Réécritures concurrentes des numéros (`updateBot`, `setStatus`, `setLlm` réécrivent la liste lue avant) ; record et numéros écrits hors transaction. | `bot-service.ts:145-168`, `connections-service.ts:133-138`, `config-store.ts:85-96` | Seule l'opération de branchement touche au numéro, en transaction |
| 6.3 | I | Réaffectation d'un numéro impossible atomiquement ; les sessions existantes restent sur l'ancien agent IA. | `bot-service.ts:175-186`, `router.ts:22-31` | Opération « brancher » transactionnelle |
| 6.4 | I | Identifiants écrasés en entier ; une valeur masquée « ••••abcd » renvoyée par un formulaire est enregistrée comme secret. | `credentials-service.ts:14-22`, `providers.ts:57-69` | Fusion champ par champ, rejet des masques |
| 6.5 | M | Upserts Postgres en UPDATE puis INSERT non atomiques (`bot_runtime_state`, identifiants) : 500 sur écriture concurrente. | `postgres.ts:442-458, 526-550, 819-849` | `ON CONFLICT DO UPDATE` sur les tables touchées |
| 6.6 | M | Sessions éternelles ; purges seulement au démarrage. | `index.ts:225-226`, `sqlite.ts:443-452` | Tâche périodique |

## 7. Hors zone, relevé au passage (pour l'audit complet de fin de 2b)

- Mode LLM : le résolveur suit le mode de l'enregistrement d'identifiants et ignore `bot.llm.mode` ; un byo sans clé bascule sur la plateforme ; `llm.mode` libre dans `CreateBotInput` (`resolver.ts:53-62`, `connections-service.ts:131-143`).
- Assistant web : le PATCH renvoie `llm:null` et `crm:null`, ce qui écrase LLM et CRM si l'assistant est rejoué (`apps/web/src/lib/bot-draft.ts:56-70`).
- `transport_error` brut exposé aux conseillers par `/health` (`dashboard-service.ts:131-136`).
- Données personnelles dans les journaux (numéros, contenu des messages, réponses LLM).
- Masquage des secrets courts (4 derniers caractères visibles).
- `recordUsage` et audit en best-effort silencieux ; audit sans état avant/après.
- `org.read` donne à tout manager ou conseiller la lecture de tous les agents IA de l'organisation (pas de filtre par entité).
- Multi-instance : `numberIndex`, `tenantCache`, `phoneLocks`, CrmBridge en mémoire locale (déjà dans les points différés).

## 8. Questions ouvertes relevées

- CM.com : existe-t-il une signature des webhooks entrants ? `messageContext` est-il unique par message ?
- Meta : fréquence réelle des POST groupés ; format exact de `display_phone_number`.
- Anthropic : acceptation d'un historique commençant par un message assistant (« [Welcome] »).
- Connecteurs CRM : `lead_id = phone` sans préfixe d'organisation, dédoublonnage sur un CRM partagé non vérifié.
