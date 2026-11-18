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

Open [shell.cloud.google.com](https://shell.cloud.google.com), then run:

```bash
cd ~/lunchbox-anywhere && ./lunchbox
```

Cloud Shell is free for about 50 hours a week. It stops after a while without use; your rooms and
your Claude sign in are kept, and `./lunchbox` starts it again.
