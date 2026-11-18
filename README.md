# keithorian.github.io

Personal site. The China trip planner is `china-trip-planner.html`.

## Health tracker

Public page, after this is on `main`: <https://keithorian.github.io/health/>

It logs weight from 92 kg on 18 Nov 2026 towards 80 kg, plus steps, cardio, sleep, readiness, heart-rate variability, resting heart rate, stress and workouts from an Oura ring. Sleep is also paired with the same day’s steps, cardio and readiness, as a description of those dates rather than a cause. Times are Singapore time (UTC+8). The dashed weight line is an illustrative 0.5 kg/week pace, not a forecast, and the page is not medical advice.

Oura data is refreshed by **Oura sync** (every 6 hours, and whenever you run it from the Actions tab). It commits `health/data/daily.json` only when the aggregated numbers change. The raw pull, including anything minute-by-minute, is not committed.

### Secrets to add

Repository secrets, under Settings → Secrets and variables → Actions. Do not commit them, and do not put them in the workflow file.

| Secret | What to put there |
| --- | --- |
| `OURA_CLIENT_ID` | Client id of the Oura application |
| `OURA_CLIENT_SECRET` | Client secret of that application |
| `OURA_REFRESH_TOKEN` | The current Oura refresh token |
| `GH_SECRETS_PAT` | Fine-grained personal access token used only to store a rotated refresh token |

Oura rotates the refresh token. The sync refreshes it, saves the new value into `OURA_REFRESH_TOKEN` with `gh secret set`, and only then downloads data. `GH_SECRETS_PAT` is what makes that save possible. The workflow's own `GITHUB_TOKEN` can commit the JSON, but it cannot write secrets.

Create the PAT at GitHub → Settings → Developer settings → Fine-grained tokens:

- Resource owner: your user
- Repository access: only `keithorian/keithorian.github.io`
- Repository permission: **Secrets → Read and write**
- No other permissions

Copy it into `GH_SECRETS_PAT` once. Set a reminder before it expires. If it expires, the next Oura refresh cannot be saved. Renew the PAT first. If a run has already rotated the Oura token and then failed to save it, the old `OURA_REFRESH_TOKEN` will not work: mint a new refresh token and update that secret before running the sync again.

The Oura application needs the `daily` and `workout` scopes. The sync does not request personal info, email, or minute-level heart rate. Token endpoint used by the workflow: `https://moi.ouraring.com/oauth/v2/ext/oauth-token`.

After the secrets are saved, run **Oura sync** once from the Actions tab to confirm it.

### Log a weight from your phone

1. Open the health page and tap **Log a weight**, or go straight to the form: <https://github.com/keithorian/keithorian.github.io/issues/new?template=log-weight.yml>
2. Enter the weight in kilograms, for example `91.4`. Leave the date blank to use today in Singapore, or enter `YYYY-MM-DD`.
3. Submit the issue. The title stays "Log weight".
4. The **Log weight** workflow checks that you opened it, updates `health/data/weight.csv`, commits to `main`, comments, and closes the issue. A second log on the same date replaces that day.
5. Reload the page after GitHub Pages republishes (usually a few minutes).

You can also run **Log weight** from the Actions tab and type the same two fields. The issue form is the one that works in the GitHub mobile app. Anyone else who submits the form is closed without a change to the log.
