# Mise à jour majeure — 3 types d'assistance

## Vue d'ensemble

Ajout d'un choix **Type d'assistance** dans Paramètres avec 3 modes :

1. **Travail en ligne** — le système actuel, inchangé.
2. **Formation** — gestion de formations (gratuites/payantes) + envoi automatique de fichiers.
3. **Vente** — gestion de produits avec stock, galerie photos, paiements.

Chacun (Formation & Vente) obtient ses propres onglets : **Offres**, **Commandes**, **Discussions**. Un contrôle global **Stop IA** est ajouté à l'accueil + par client.

---

## 1. Base de données (nouvelle migration)

### Nouveau champ `settings`

- `assistance_type` : `'online_work' | 'training' | 'sales'` (défaut `online_work`)
- `global_ia_stopped` : boolean (défaut false) — Stop IA global depuis l'accueil

### Nouvelle table `payment_methods`

Numéros/instructions de paiement partagés par formations payantes et produits.

- `label` (ex: "Mvola"), `number`, `instructions`, `is_active`

### Nouvelle table `trainings`

- `name`, `description`, `pricing_type` (`free` | `paid`)
- `price` (nullable si free)
- `payment_flow` (`admin_numbers` | `client_contact`) — les 2 modes payants
- `video_link` (url externe optionnelle)
- Fichiers liés dans storage bucket `training-files` (private)

### Nouvelle table `training_files`

- `training_id`, `file_path`, `file_type` (`video`|`pdf`|`document`), `file_name`, `size_bytes`

### Nouvelle table `products`

- `name`, `price`, `stock`, `description`, `payment_flow` (`admin_numbers` | `client_contact`)

### Nouvelle table `product_images`

- `product_id`, `image_path`, `sort_order` (max 50, envoi par lots de 4)

### Nouvelle table `orders`

- `type` : `training` | `sales` (isole les 2 listes)
- `training_id` / `product_id` (nullable)
- `status` : `pending` | `awaiting_payment` | `payment_sent` | `accepted` | `refused` | `delivered`
- `client_fb_id`, `client_fb_name`, `client_whatsapp`, `client_phone`
- `payment_reference` (num de l'expéditeur pour flux admin_numbers)
- `notes`, `quantity` (pour vente)

### Nouvelle table `client_ia_state`

- Contrôle IA par client Facebook
- `page_id`, `client_fb_id`, `ia_stopped` (bool)

### Nouveau bucket storage

- `training-files` (private) — jusqu'à 500 Mo par vidéo
- `product-images` (public, réutilise `post-images` ou nouveau)

Toutes les tables : RLS scope `auth.uid()`, GRANT authenticated + service_role, triggers `updated_at`.

---

## 2. Interface — nouvelles pages

### Paramètres → nouveau bloc "Type d'assistance"

Select : Travail en ligne / Formation / Vente. Sauvegarde immédiate.

### Sidebar dynamique (selon `assistance_type`)

- **online_work** : Prompts, Messages, Commentaires, Auto-post, Facebook, Clés API, Paramètres (comme aujourd'hui)
- **training** : Prompts, **Formations**, **Commandes (formations)**, **Discussions**, Facebook, Clés API, Paramètres
- **sales** : Prompts, **Produits**, **Commandes (vente)**, **Discussions**, Facebook, Clés API, Paramètres

### `/formations` — CRUD formations

Formulaire : nom, type (gratuit/payant), si payant → prix + choix flux (numéros admin / contact client), description, upload multi-fichiers (vidéo 500 Mo max, pdf, word), lien vidéo externe.
Si `admin_numbers` → afficher gestion des `payment_methods`.

### `/produits` — CRUD produits

Formulaire : nom, prix, stock, description, méthode de paiement (identique formations, sans gratuit), galerie 50 images max.

### `/commandes` — liste des commandes

Filtrées par type selon la page. Boutons **Accepter** / **Refuser** / **Marquer livré**. Vue détail avec infos client.

### `/discussions` — messagerie live

Liste des conversations Messenger avec chaque client. Envoi de texte, image, vocal. Bouton **Stop IA / Reprendre IA** par conversation.

### Accueil (Dashboard)

Bouton **Stop IA** global (grand toggle en haut).

---

## 3. Moteur IA (`ai-engine.server.ts`)

### Sélection du prompt selon `assistance_type`

Le prompt système inclut :

- Pour **training** : liste des formations disponibles (nom, description, prix), instructions du flux de paiement, règle "ne jamais envoyer les fichiers avant confirmation paiement"
- Pour **sales** : catalogue produits (nom, prix, stock, description), règles galerie 4 par 4
- Pour **online_work** : comportement actuel

### Détection d'intention (tool-calling ou parsing structuré)

L'IA renvoie des actions structurées :

- `SEND_TRAINING_FILES(training_id)` — uniquement si gratuit OU commande `accepted`
- `CREATE_ORDER(type, item_id, client_info, payment_ref?)` — insère dans `orders`
- `SEND_PRODUCT_IMAGES(product_id, batch_offset)` — 4 images à la fois
- `SEND_PAYMENT_INSTRUCTIONS(item_id)` — numéros admin
- `REQUEST_CLIENT_CONTACT` — pour flux `client_contact`

### Contrôle Stop IA

Avant chaque réponse : vérifier `settings.global_ia_stopped` ET `client_ia_state.ia_stopped` — si l'un est vrai, ignorer.

### Confirmation paiement (flux admin_numbers)

Admin clique "Accepter" sur la commande → trigger côté serveur envoie automatiquement les fichiers de formation OU les infos livraison au client via Messenger, met status `accepted`/`delivered`, décrémente le stock.

---

## 4. Détails techniques

- **Server fns** : nouveaux fichiers `trainings.functions.ts`, `products.functions.ts`, `orders.functions.ts`, `payment-methods.functions.ts`, `discussions.functions.ts`, `ia-control.functions.ts`.
- **Upload fichiers** : direct-upload vers Supabase Storage avec signed URLs (500 Mo → dépasse la limite serveur, obligatoire côté client).
- **Envoi fichiers Messenger** : utilise Facebook Graph `/me/messages` avec `attachment` (upload file_id d'abord).
- **Décrémentation stock** : transaction sur acceptation commande.
- **Migration progressive** : les tables `prompts`, `messages_log`, `comments_log` gardent leur structure — un champ `assistance_type` peut être ajouté aux prompts pour scoper.

---

## Ordre d'exécution

1. Migration SQL (nouvelles tables + settings + bucket).
2. Server functions (CRUD).
3. Type d'assistance dans Paramètres + Sidebar dynamique.
4. Pages Formations / Produits + upload.
5. Page Commandes + workflow accept/refuse.
6. Page Discussions + Stop IA par client.
7. Bouton Stop IA global sur l'accueil.
8. Mise à jour du moteur IA (prompts contextuels + actions structurées).
9. Auto-livraison à l'acceptation.

C'est un chantier volumineux (≈15 fichiers créés/modifiés). Je peux commencer immédiatement dès que tu approuves le plan.
