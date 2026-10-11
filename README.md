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

**The plugin never writes scene ratings, scene tags, or scene custom fields.** Suggestions are calculated on demand from the model and scene tags. They are sortable within the advisor; they are not native Stash rating filters or persisted custom fields. Only advisor plugin settings are written. The optional compilation metadata lookup uses Stash’s `runPluginOperation` mutation with the read-only `screening_list` action.

## Guided recalibration (0.3.0)

After reviewing your labels, choose **Recalibrate from my ratings** (at least 20 rated scenes). This jointly refits the starting score and label strengths; it does not merely rescale the final scores.

Your manual corrections guide the refit: positive corrections stay non-negative, negative corrections stay non-positive, and explicit zero stays zero. Strengths may shrink to zero. Ignored and automatic metadata labels remain excluded. Accepted labels continue to follow learning. Manual corrections with fewer than three rated examples retain their exact values. Labels absent from training also retain their saved correction.

To freeze a correction, open that label under **Review labels → Reviewed** and check **Lock exact contribution during recalibration**. This is available for numeric corrections. Uncheck to permit guided adjustment again.

The preview compares held-out prediction error, the number of scenes displayed as 5.0, raw scores exceeding 5, maximum raw score, and the largest label-weight changes. The five-star count includes scores at least 4.95, which display as 5.0 to one decimal. Counts cover the loaded library; held-out errors compare models refitted without the same 20% of rated scenes. Earlier manual judgments may reflect those scenes, so this is not a completely independent prospective evaluation. Reduced saturation or improved error is not guaranteed.

Choose **Apply recalibration** to save the proposal, or **Keep current model** to discard it. Preview alone writes nothing. **Undo recalibration** restores the preceding model, rules, and review history, including after a browser reload. This single-step backup remains until another rule edit or training result is saved; applying again replaces it. Applying clears the per-label undo stack to avoid mixing it with decisions from an older model, but retains current review decisions. Existing scene ratings are never changed.

After applying guided learning, **Learn from my ratings** also opens a guided preview so later training does not silently revert to the old fixed-override workflow. New numeric corrections replace earlier guidance, while repeated recalibration retains the original guidance direction and prior strength.

Implementation: constrained ridge regression with the existing L2 penalty of 10, plus a weak squared-distance penalty of 2 toward each unlocked correction's original value. Locked/zero/rare corrections are fixed while fitting; their contributions are included in the residual calculation. The preview's before-model reproduces ordinary learning plus overrides for the original model, or refits with fixed current corrections for an already-guided model. Both sides use the same training/held-out partition. The final proposed model is then fitted on all rated scenes.

Performer, studio, and duration inputs remain possible future extensions; this release still uses scene tags only.

## Review labels (0.2.0)

Open **Review labels** after learning. The queue starts with the largest absolute learned effects and hides automatically excluded metadata labels. Search and switch between Needs review, Skipped for now, Reviewed, or All eligible labels.

- **Accept** uses the learned contribution and marks it reviewed; it does not freeze a weight. A later change of at least 0.25 stars, or a direction reversal spanning at least 0.10 stars, returns the label for review.
- **Ignore** removes the label from predictions and future training. Retrain to refit the other weights and starting score.
- **Score lower / Score higher** opens a slider and exact stars input. Preview the contribution, cross zero to reverse direction, then **Save correction and next**. The correction replaces the learned weight and survives retraining.
- **Skip for now** defers the review while preserving the current scoring rule.
- **Reset decision** restores unreviewed, learned behavior. **Undo last decision** restores the previous rule; the last 30 review decisions are stored across reloads.

Review actions save automatically and advance only after successful storage. The ordinary Tag weights table still uses Save changes. A few high- and low-rated examples help explain each label; they illustrate the evidence rather than isolate its causal effect.

The visual effect bar uses the same −1 to +1 star scale for every label, with zero at the center. Larger contributions reach the edge and show an overflow note and their exact value. A 3.0-star example previews the result, clipped to 1–5. Qualitative effect labels use absolute movement: very small below 0.10 stars, small below 0.25, moderate below 0.50, large below 1.00, and very large above. These are display conventions, not statistical confidence levels.

### Automatic compilation metadata exclusions

`Screened: …`, `Absent: …`, and `Marker Compilations · …` are excluded from training, predictions, and the review queue. The dashboard also reads the enabled Marker Compilations plugin's `screening_list` operation to discover configured screened/absent tag IDs, covering renamed/custom status labels. Known IDs are retained in advisor settings when decisions or training are saved. Failure to read custom metadata displays a warning; default name exclusions and previously saved IDs remain active. Content marker tags are not automatically excluded.

After upgrading from 0.1.0, reload the library and **Learn from my ratings** once to remove metadata influence from the saved model's starting score and weights. Existing overrides are preserved, but automatic exclusions take precedence.

## Learning and quality

The model fits a starting score plus one coefficient per tag, minimizing squared error plus an L2 penalty (fixed strength 10). Binary tag presence is used; duplicates count once. A tag requires at least three rated training examples. Null/zero ratings are treated as unrated and excluded. Predictions are clipped to 20–100 internally (1–5 displayed).

For ordinary learning with 20 or more rated scenes, a reproducible 20% split is withheld, a model is trained only on the remaining scenes, and mean absolute error is compared with predicting the training-set average. The held-out check is performed **before** fitting the saved model on all rated scenes. Ordinary learning evaluates learned weights, not manual overrides; guided recalibration includes its constrained corrections. Smaller errors are better. The dashboard explicitly reports when tags fail to improve on the average baseline.

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

For browser integration, launch a **separate disposable Stash** on `127.0.0.1:19998` with this repository's `plugins` directory. Run `python3 tests/seed-demo.py` once on its empty library, then `node tests/browser.cjs` , `node tests/review-browser.cjs`, and `node tests/recalibration-browser.cjs` (Chrome required). The script checks learning, server persistence, manual weights, scene integration, ignored tags, responsive layout, and absence of scene-rating writes. All screenshots and test data belong in ignored `.test-runtime/`.

License: AGPL-3.0; see LICENCE.

## Publishing

The included `.github/workflows/deploy.yml` builds `_site/main` and deploys `_site` to GitHub Pages from `main` (or manual dispatch). Enable GitHub Pages with GitHub Actions in the actual repository. After deployment, verify the live index, package availability, version/date, and checksum, and keep the installation URL above current. See the parent workspace `AGENTS.md` for the established delivery workflow.
