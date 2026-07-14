# Règle de méthode — Consulter l'ancienne app (Copilote) avant toute modification majeure

**Décidée par :** Alain St-Jean (PO), 9 juillet 2026
**Statut :** Règle permanente de gouvernance Primexpert
**S'applique à :** tout chantier V2 impliquant une refonte, une reconstruction, ou un correctif
sur une fonctionnalité qui existait déjà dans l'ancienne application.

---

## La règle
**Avant toute modification majeure ou reconstruction dans Primexpert V2, lire d'abord comment
l'ancienne application le faisait.**

Ancienne app = **Copilote** (`copilote-pour-courtiers-en-rpa`), code source local :
`/Volumes/SAUVEGARDE GRIS/00_RPA_SYSTEME_APP/Copilote-RPA` (fichiers `.jsx` sous `src/`).

## Pourquoi
1. **Copilote est une référence qui a tourné en production** — avec de vrais courtiers, sur de
   vraies transactions RPA. Ce qui y fonctionnait a été validé par l'usage réel.
2. **Éviter de réinventer moins bien.** Exemple vécu (9 juillet) : V2 avait remplacé le système
   d'application des montants extraits (inline, par champ, multi-documents, robuste chez Copilote)
   par un bandeau transitoire mono-document fragile qui disparaissait après 3 secondes. Regarder
   Copilote AVANT la refonte aurait préservé la bonne approche.
3. **Extension de la Règle #0** (« ne jamais reconstruire ce qui existe ») : avant de reconstruire,
   aller voir comment l'ancien le faisait — il a peut-être déjà la réponse éprouvée.

## Comment l'appliquer
- La **première étape read-only** d'un chantier V2 inclut désormais une lecture de l'équivalent
  Copilote (grep + lecture du composant/service concerné).
- On compare les deux méthodes : ce que l'ancien faisait, ce que le nouveau fait, ce qui a été
  perdu ou amélioré.

## Nuance importante — « comprendre, puis décider », pas « l'ancien a toujours raison »
L'ancien n'est PAS toujours meilleur. V2 a parfois changé des choses volontairement et à raison.
Exemple : Copilote appliquait certains montants automatiquement ; V2 a introduit le HITL
(validation humaine avant écriture des données financières) — c'est un PROGRÈS, à conserver.
Donc la règle est : **regarder l'ancien pour comprendre la logique métier qui marchait, puis
adapter au contexte V2 en gardant les progrès voulus** (HITL, cloisonnement OACIQ, Loi 25...).
On garde le meilleur des deux, on ne copie pas aveuglément.

## Résumé en une phrase
Avant de refondre : lire Copilote → comparer → garder ce qui marchait, préserver les progrès V2,
adapter proprement. Ne jamais reconstruire à l'aveugle une fonctionnalité qui existait déjà.
