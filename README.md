# Scene Score Advisor

A standalone Stash plugin that learns how scene tags relate to your ratings and shows an independent suggested score. All scores are displayed on a **1–5 scale**; 20 internal points equal one star. Suggestions retain one decimal place, even if your Stash rating control uses whole stars.

## Install through Stash

**Published:** source index and package availability, SHA-256, and version verified on 2026-10-11.

Repository: https://github.com/helperbot-3/stash-scene-score-advisor-plugin

Add this source URL in Stash:

```text
https://helperbot-3.github.io/stash-scene-score-advisor-plugin/main/index.yml
```

This plugin follows the same installation and update workflow as Marker Compilations and Library Triage. The source is published through GitHub Pages:

1. Add the source URL above under **Settings → Plugins → Available Plugins → Sources**.
2. Refresh available plugins, install **Scene Score Advisor**, and refresh the browser.
3. Open **Score Advisor** in the main navigation (also available under **Settings → Tasks**), or navigate to `/scene-score-advisor` on your Stash server.
4. Review **Tag weights** and ignore any tags that reveal a scene's existing rating. Common rating-derived names are excluded automatically; arbitrary names cannot be detected reliably.
5. Choose **Learn from my ratings**. At least 10 rated scenes are required; 20 enables a held-out prediction check.
6. Browse **Scene suggestions**, filter to unrated scenes, and open the score breakdown. Each scene also gets a **Suggested score** tab.

Updates are delivered through the same Stash plugin source. Archives are build artifacts for the plugin manager, not a manual installation step.

Requires a Stash version supporting the plugin UI API, `configuration.plugins`, and `configurePlugin`. Integration-tested with Stash v0.31.1 (database schema 85). No Python or third-party service is needed at runtime; calculation happens in your browser.

## What it does

- Learns positive and negative scene-tag contributions with regularized linear regression.
- Shows your actual rating and suggested score separately.
- Lets you override individual tag weights in **stars**, or ignore a tag entirely.
- Explains the starting score, each contribution, unseen tags, and clipping to 1–5.
- Sorts scene suggestions and searches scenes/tags, with 50 rows per page.
- Stores the model and overrides on the Stash server in this plugin's configuration, shared across browsers.

**The plugin never writes scene ratings, scene tags, or scene custom fields.** Suggestions are calculated on demand from the model and scene tags. They are sortable within the advisor; they are not native Stash rating filters or persisted custom fields. Plugin configuration changes are the only mutations used.

## Learning and quality

The model fits a starting score plus one coefficient per tag, minimizing squared error plus an L2 penalty (fixed strength 10). Binary tag presence is used; duplicates count once. A tag requires at least three rated training examples. Null/zero ratings are treated as unrated and excluded. Predictions are clipped to 20–100 internally (1–5 displayed).

For 20 or more rated scenes, a reproducible 20% split is withheld, a model is trained only on the remaining scenes, and mean absolute error is compared with predicting the training-set average. The held-out check is performed **before** fitting the saved model on all rated scenes. It evaluates learned weights, not manual overrides. Smaller errors are better. The dashboard explicitly reports when tags fail to improve on the average baseline.

Overrides **replace** a learned contribution; they are not added on top of it. Ignoring a tag immediately removes its contribution. Retrain after changing exclusions to refit the starting score and remaining weights. Overrides survive retraining. Blank an override to return to its learned weight.

Tags that co-occur are hard to separate. Rare tags, selective rating habits, inconsistent tagging, and factors absent from tags limit accuracy. Example counts are evidence indicators, not calibrated confidence probabilities. There are no performers/studios, text embeddings, interactions, or external AI calls in this version.

## Updates and storage

Use **Reload library** to fetch current ratings and tags, then **Learn from my ratings** to retrain. Rated-scene changes detected after loading trigger a stale-model notice. Changing an unrated scene's tags changes its suggestion when that scene is loaded again. Retraining is manual; there are no background jobs.

Learning saves the new model and rules together. Manual rule edits preview immediately and require **Save changes**. An error keeps your unsaved changes visible. Save before leaving the page. Avoid editing settings simultaneously in multiple tabs: the last save wins. Stash's config backup includes the saved model. Back up that configuration before removing the plugin if you want to retain your weights.

The dashboard fetches scene metadata in batches of 500 and holds it in browser memory. It does not fetch video files or images. Training yields periodically so the browser can remain responsive, but very large libraries have not been benchmarked.

## Development

- `npm ci`
- `npm test` — regression, validation, prediction, storage validation, and safety tests.
- `npm run build` — creates the installable ZIP and Stash source index in `_site/main`.

For browser integration, launch a **separate disposable Stash** on `127.0.0.1:19998` with this repository's `plugins` directory. Run `python3 tests/seed-demo.py` once on its empty library, then `node tests/browser.cjs` (Chrome required). The script checks learning, server persistence, manual weights, scene integration, ignored tags, responsive layout, and absence of scene-rating writes. All screenshots and test data belong in ignored `.test-runtime/`.

License: AGPL-3.0; see LICENCE.

## Publishing

The included `.github/workflows/deploy.yml` builds `_site/main` and deploys `_site` to GitHub Pages from `main` (or manual dispatch). Enable GitHub Pages with GitHub Actions in the actual repository. After deployment, verify the live index, package availability, version/date, and checksum, and keep the installation URL above current. See the parent workspace `AGENTS.md` for the established delivery workflow.
