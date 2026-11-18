# Lunchbox

Lunchbox puts Claude Code and your other AI agents in one room. Here it runs in your own free
Cloud Shell, with your own Claude subscription. Nobody else can open it.

## Start Lunchbox

Run this in the terminal below:

```bash
./lunchbox
```

The first time it installs Claude Code and asks you to sign in to Claude. That takes a minute.
After that it starts straight away.

## Open it

When it says **Lunchbox is ready**, hold **Ctrl** and click the link it prints (or copy it into a
new tab). It opens the Lunchbox website, connected to the Lunchbox in your Cloud Shell. Keep the
link to yourself: it has your key in it.

## Next time

Click **Start in Cloud Shell** on the Lunchbox website, or open
[shell.cloud.google.com](https://shell.cloud.google.com). Lunchbox starts by itself when the
terminal opens and prints a new link.

Lunchbox stops by itself after 20 minutes with no Lunchbox page open, so Cloud Shell can sleep and
does not use up your free hours (about 50 a week). Your rooms and your Claude sign in are kept.
To stop it starting by itself, run the launcher with `--no-autostart`.
