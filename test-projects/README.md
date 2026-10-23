# Test projects for LiaraPilot

Each folder has a ready-to-upload `.zip` next to it. Upload them from **Apps → Create** (the assistant path), wait about 6 minutes after the deploy (the first minutes are shown as "starting up"), then press **بررسی عملکرد** on the app overview.

| Zip | Edge case | What LiaraPilot does (tested on a real Liara account) |
| --- | --- | --- |
| `healthy-app` | Nothing is wrong (control) | Green status; the AI says everything is fine and proposes nothing. |
| `wrong-port` | Listens on 8080 but is deployed with port 3000 → HTTP 502 | Finds the mismatch from the app's own log line and proposes **change app port to 8080**. After approval the site returns 200. |
| `memory-heavy` | Needs ~700 MB of RAM at startup, the smallest plan has 512 MB → killed again and again | Recognises a stable need (not a leak) and proposes **change plan** to the smallest plan that fits, with the price. After approval the site returns 200. |
| `memory-leak` | An array grows forever | Detects the leak from the app's memory log lines; says a bigger plan only delays the crash and gives a **manual** fix (names the array and the file). |
| `orders-api-broken` | Needs `DATABASE_URL`, which is not set | Proposes **setting the variable**: asks for the value, saves it and restarts the app. |
| `flask-no-requirements` | Python app without `requirements.txt` | The wizard blocks it; "رفع با هوش مصنوعی" builds `requirements.txt` from the imports and shows the change. |
| `php-guestbook` | `index.html` + `api.php`, no `composer.json` | Detected as **PHP** (not "static"); choosing the static platform manually is refused with the reason. |
| `bad-package` | Typo'd package (`expresss`) and a non-existent version | The wizard flags both before deploy and offers a fix. |
| `syntax-error-app` | Missing `});` | The wizard shows the syntax error; the AI proposes the exact patch. |
| `version-mismatch-app` | Express 5 with an Express 4 wildcard route | Crashes at startup; the AI proposes the `/files/*splat` patch. |
| `slow-cpu` | Burns CPU on every request | CPU saturation: explains it is in the code (a busy loop) and gives a manual fix; no blind plan upgrade. |
| `fullstack-todo` | React front end + Express API + MongoDB, hard-coded `localhost` addresses | Detected as a multi-part project: plan with 2 apps + MongoDB on one network, environment variables for the connections, two code edits (API address and database address). Both apps deploy after you confirm. |

Notes
- Apps cost real Liara credit while deployed; delete them when you are done.
- For the multi-part demo give a base name such as `todo`; it creates `todo-backend`, `todo-frontend` and `todo-mongodb`.
