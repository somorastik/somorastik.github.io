# somorastik.github.io

Browser instruments and projects, served at https://somorastik.github.io/.

| Project | Play | Source branch |
|---|---|---|
| LubkaM1, six-voice drum synth (study port of open-source drum-synth firmware, GPL-3.0) | [/lubkam1/](https://somorastik.github.io/lubkam1/) | [`lubkam1`](https://github.com/somorastik/somorastik.github.io/tree/lubkam1) |
| Six-Pad Sampler, a clean-room Roland P-6 study (unofficial) | [/p6-sampler/](https://somorastik.github.io/p6-sampler/) | [`p6-sampler`](https://github.com/somorastik/somorastik.github.io/tree/p6-sampler) |
| Great Chess, Tamerlane's chess | [/great-chess/](https://somorastik.github.io/great-chess/) | [`great-chess`](https://github.com/somorastik/somorastik.github.io/tree/great-chess) |

## How the site is put together

- `main` holds the site shell (`index.html`: side menu, gallery and a viewer that runs each project in a frame) and the gallery screenshots in `assets/`.
- Each project is developed in its own branch. Every project branch carries `.github/workflows/sync-to-site.yml`, which copies the project branches into their folders on `main` whenever one of them changes, so GitHub Pages can keep serving `main` as it is. (A push runs the workflows of the pushed branch, so the file must be in each project branch. The copy on `main` lets you run the sync by hand from the Actions tab.)
- Don't edit `lubkam1/`, `p6-sampler/` or `great-chess/` on `main` directly; the next sync overwrites them. Change the project's branch instead.
- To add a project: create a branch with an `index.html` and the sync workflow, add the branch name to the workflow in every branch and to the `PROJECTS` list in `index.html`, and add a screenshot as `assets/<branch>.jpg`.

Each project's licence and credits are in its own branch's README.
