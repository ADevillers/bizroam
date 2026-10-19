# Bizroam pitch

- `bizroam-pitch.html`: standalone five-slide English presentation. Images and fonts are embedded; it works offline.
- `bizroam-pitch.pdf`: portable 16:9 PDF, five pages.
- `speaker-notes.md`: suggested four-minute script.

Open the HTML in a browser. Use Left/Right or Space to navigate, F for full screen. The PDF has no presentation controls.

The application screenshots show a saved real San Francisco session. They contain no session credentials. The private source snapshot remains outside this directory in the ignored `.data` directory. The map imagery is attributed to OpenStreetMap contributors.

To rebuild after updating the screenshots in `assets/`:

```bash
python3 presentation/build.py
npm exec --yes --package=node@24 -- node presentation/export.mjs
```

`capture.ts` is an internal local-only screenshot harness; it does not alter the production application.
