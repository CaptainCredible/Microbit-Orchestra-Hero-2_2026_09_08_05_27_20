# Task: clean up and push github.com/CaptainCredible/ubitWebUSB

You are working on a small public repo of mine: a p5.js helper for talking to a
BBC micro:bit over WebUSB. Clone it, make the five changes below, verify, show
me the diff, and push once I say go.

    git clone https://github.com/CaptainCredible/ubitWebUSB.git
    cd ubitWebUSB

## What the repo is

`ubitwebusb.js` is adapted from Bill Siever's microbit-webusb. The important
part is already correct: it uses the **DAPjs** transport, which is what makes
it work on micro:bit **V2.21** boards (the older version spoke raw HID control
transfers on a hardcoded `claimInterface(4)`, which newer DAPLink firmware does
not expose). **Do not change the transport.** The job is tidying and
robustness, not a rewrite.

The public API must not change. Sketches in the wild call these, and
`exampleSketch.js` in the repo relies on them:

    setupuBitSerial()        uBitWriteLine(data)       connectedDevice
    uBitConnectDevice(cb)    uBitSend(device, data)    uBitDisconnect(device)
    onReceivedString(s)      onReceivedValue(name, value)

Callback reasons must stay exactly: `"connected"`, `"disconnected"`,
`"connection failure"`, `"error"`, `"console"`, `"graph-data"`, `"graph-event"`.

## First: check these facts still hold

This was all verified on 2026-10-16 against `main` (last pushed 2025-03-25).
If the file has changed since and the line numbers or text below no longer
match, **stop and tell me** rather than guessing.

- `ubitwebusb.js` is 274 lines, 47,349 bytes
- lines 1–243 are the real code
- lines 245–260 are an **inlined copy of the whole DAPjs library**, byte-for-byte
  identical to the separate `dap.umd.js` in the repo (I checked with `diff`)
- lines 261–274 contain a **duplicated** block
- `index.html` does **not** have a `<script src="dap.umd.js">` tag

## Change 1 — stop shipping DAPjs twice

The repo contains DAPjs in two places: inlined inside `ubitwebusb.js`, and as
`dap.umd.js`, which nothing currently loads. Above the inlined copy sit two
leftover lines from an abandoned load-a-script-at-runtime trick; `newScript`
never gets a `src` and is never used for anything.

Delete from `ubitwebusb.js`: the stackoverflow comment line, both `newScript`
lines, the entire inlined DAPjs bundle, and its `//# sourceMappingURL` line —
i.e. everything from

    //stackoverflow.com/questions/5892845/how-to-load-one-javascript-file-from-another
    var newScript = document.createElement('script');
    newScript.type = 'text/javascript';

down to and including

    //# sourceMappingURL=dap.umd.js.map

Then load the library properly in `index.html`, with a plain script tag
**before** `ubitwebusb.js`:

    <script src="dap.umd.js"></script>
    <script src="ubitwebusb.js"></script>

Do **not** reintroduce runtime script injection. A plain tag is easier to
follow and fails loudly if the file is missing.

`ubitwebusb.js` should end up around 8–9 KB.

## Change 2 — the end of the file is duplicated

These fourteen lines appear **twice**, so every unplug calls `uBitDisconnect`
twice (it survives that only because of the `device.callback = null` guard
inside it):

    document.getElementsByTagName('head')[0].appendChild(newScript);

    navigator.usb.addEventListener('disconnect', (event) => {
        if("device" in event && "callback" in event.device && event.device.callback!=null && event.device.productName.includes("micro:bit")) {
            uBitDisconnect(event.device)
        }
     })

Replace both copies with **one** listener. The `appendChild` lines go entirely
(`newScript` no longer exists after change 1). Also make it safe against a
browser with no WebUSB, and against a device with no `productName` — as written
it throws a TypeError on `undefined.includes`:

    // Unplugging the micro:bit. Only devices this file opened carry a
    // callback, so anything else unplugged is ignored.
    if (navigator.usb) {
        navigator.usb.addEventListener('disconnect', (event) => {
            if("device" in event && event.device.callback && (event.device.productName || "").includes("micro:bit")) {
                uBitDisconnect(event.device)
            }
        })
    }

## Change 3 — a failed connection should report, not throw

In `uBitOpenDevice`, these two awaits are unprotected, so a board that is
unplugged mid-connect, or already held by another tab, produces an unhandled
promise rejection and the sketch is never told:

    const transport = new DAPjs.WebUSB(device)
    const target = new DAPjs.DAPLink(transport)
    await target.connect()
    await target.setSerialBaudrate(115200)
    device.target = target;

Make it:

    const transport = new DAPjs.WebUSB(device)
    const target = new DAPjs.DAPLink(transport)
    try {
        await target.connect()
        await target.setSerialBaudrate(115200)
    } catch (error) {
        callback("connection failure", device, error)
        return
    }
    device.target = target;

`"connection failure"` is already one of the documented reasons and is already
used by the `requestDevice` catch further down, so nothing new is introduced.

## Change 4 — `uBitSend` crashes on a null device

Currently:

    function uBitSend(device, data) {
        if(!device.opened)
            return

That throws a TypeError if `device` is null — which is exactly what
`connectedDevice` is before connecting or after an unplug — and it does not
check that the connection actually finished. Make it:

    function uBitSend(device, data) {
        if(!device || !device.opened || !device.target)
            return
        let fullLine = data+'\n'
        device.target.serialWrite(fullLine)
    }

## Change 5 — README

Add the `dap.umd.js` script tag to the setup instructions, since the library is
no longer inlined and a project that copies only `ubitwebusb.js` will now fail.
Both files have to go into the project, and both tags into `index.html`, DAPjs
first. Keep the rest of the README, including the credit to Bill Siever and the
"bad response 8 -> 17" note.

## Leave alone

- the glue at the top (`setupuBitSerial`, `uBitWriteLine`, `uBitEventHandler`, …)
- the line parser and its regex — scores come back through it as `S1:45`
- `dap.umd.js` itself — do not re-minify or upgrade it
- the empty `libraries` entry
- `exampleSketch.js`, `style.css`, `jsconfig.json`
- the file's existing formatting and comment style. Change the lines above and
  nothing else; do not reformat or "modernise" the rest

## Verify before showing me the diff

There is no micro:bit attached, so nothing can be confirmed against hardware.
Say so plainly in your report rather than implying it was tested. Do check:

1. `ubitwebusb.js` parses — e.g. `node --check ubitwebusb.js`
2. The DAPjs bundle is gone: the file is ~8–9 KB, and `grep -c "sourceMappingURL" ubitwebusb.js` is 0
3. Exactly one unplug listener: `grep -c "addEventListener('disconnect'" ubitwebusb.js` is 1
4. `dap.umd.js` is unchanged — compare its SHA-256 against the clone before your edits
5. Serve the folder (`python3 -m http.server`) and open `index.html` in Chrome.
   The console must be clean, and `typeof DAPjs` must be `"object"` —
   that proves the script tag replaced the inlined copy correctly
6. In that console, `uBitSend(null, "A")` and `uBitSend(undefined, "A")` must
   return quietly instead of throwing

## Then

Show me the full diff and your verification results. **Do not push until I say
go.** When I do:

    git checkout -b fix/dapjs-cleanup
    git commit -am "Load DAPjs from dap.umd.js, de-duplicate the unplug listener, harden connect and send"
    git push -u origin fix/dapjs-cleanup

Commit message body should say briefly what changed and that it was not tested
against hardware. End the commit message with:

    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

If `gh` is available, offer to open a PR; otherwise give me the compare URL.
