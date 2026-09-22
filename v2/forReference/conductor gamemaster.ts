//added radiosend for mum (d) and cat (c)
let playTones = true
let displayNoteNumber = 0
let thisData = ""
let stringyArray: string[] = []
let solo = false
let mute = false
let clearTimer = 0
let inData = ""
let hasCleared = false
basic.showLeds(`
    # . . . #
    . . # . .
    # . # . #
    . . # . .
    # . . . #
    `)
hasCleared = false
radio.setGroup(84)

// ---- radio group helpers ----------------------------------------------------
// The whole system rests on group 84 (control / clock / game / scores) and only
// dips to group 83 (instrument / note bus) long enough to fire a note.
// Every radio send goes through one of these two helpers so the board can never
// be left stranded on the wrong group. In particular, the score relay at the
// bottom of this file only hears packets on the CURRENTLY set group, and scores
// arrive on 84 — so any instrument send that forgets to return to 84 silently
// eats scores. Routing all sends through here makes 84 the guaranteed resting
// group by construction instead of by hand-tracking.

// send a note/command to the passive instruments (they sit forever on 83),
// then come home to 84 so we can still hear clock ticks and scores.
function sendToInstruments(name: string, value: number) {
    radio.setGroup(83)
    radio.sendValue(name, value)
    radio.setGroup(84)
}

// send a control message on 84. 84 is home, so there is nothing to return to,
// but wrapping it keeps every case in the switch ending on a known group.
function sendToControl(name: string, value: number) {
    radio.setGroup(84)
    radio.sendValue(name, value)
}
// -----------------------------------------------------------------------------

basic.forever(function () {
    updateMuteAndSoloLeds()
})

serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    inData = serial.readUntil(serial.delimiters(Delimiters.NewLine))
    handleMessages()
})

OrchestraMusician.onButtonABHeldFor(1000, function () {
    led.toggle(2, 0)
    OrchestraMusician.gameMaster("RESET")
})

let wasGameMsg = false;

function handleMessages() {
    //first check for game messages
    if (inData[0] == "X") {
        OrchestraMusician.gameMaster("A")
        OrchestraMusician.gameMaster("B")
        sendToInstruments("MumP", 0b00000101)
        if (playTones) {
            PERCPLAY() //plays perc noises
        }
        led.plot(0, 1)
        led.plot(0, 2)
        led.plot(0, 3)
        led.plot(0, 4)
        led.plot(4, 1)
        led.plot(4, 2)
        led.plot(4, 3)
        led.plot(4, 4)
        clearTimer = input.runningTime()
        hasCleared = false
    } else if (inData[0] == "A") {
        OrchestraMusician.gameMaster("A")
        sendToInstruments("MumP", 0b00000001)
        if (playTones) {
            BDPLAY()
            //music.ringTone(249)
        }
        led.plot(0, 1)
        led.plot(0, 2)
        led.plot(0, 3)
        led.plot(0, 4)
        clearTimer = input.runningTime()
        hasCleared = false
    } else if (inData[0] == "B") {
        OrchestraMusician.gameMaster("B")
        sendToInstruments("MumP", 0b00000100)
        if (playTones) {
            SDPLAY()//music.ringTone(649)
        }
        led.plot(4, 1)
        led.plot(4, 2)
        led.plot(4, 3)
        led.plot(4, 4)
        clearTimer = input.runningTime()
        hasCleared = false
    } else if (inData[0] == "R") {
        OrchestraMusician.gameMaster("RESET")
        led.plot(0, 1)
        led.plot(0, 2)
        led.plot(0, 3)
        clearTimer = input.runningTime()
        hasCleared = false
    } else if (inData[0] == "Q") {
        OrchestraMusician.gameMaster("SCORE")
        led.toggleAll()
        clearTimer = input.runningTime()
        hasCleared = false
    } else {
        handleConductorMessages(inData)
    }
}

function updateMuteAndSoloLeds() {
    if (input.runningTime() > clearTimer + 30) {
        if (!(hasCleared)) {
            hasCleared = true
            basic.clearScreen()
            music.stopAllSounds()
            led.plot(2, 2)
            if (mute) {
                led.plot(2, 0)
            }
            if (solo) {
                led.plot(2, 4)
            }
        }
    }
}

function handleConductorMessages(stringy: string) {
    // readUntil already strips the delimiter, so keep every character
    // make an array
    stringyArray = stringy.split("#")
    for (let i = 0; i <= stringyArray.length - 1; i++) {
        thisData = stringyArray[i]
        // messages are "#" terminated, not "#" separated, so split() always leaves an
        // empty chunk at the end. skip it (and any stray line ending) instead of
        // falling through to the Confused icon
        if (thisData.length == 0 || thisData.charCodeAt(0) <= 32) {
            continue
        }
        switch (thisData[0]) {
            case "n":
                let noteBits = 0b0000000000000000
                for (let j = 1; j < thisData.length; j++) {
                    let thisNote = parseInt(thisData[j])
                    let thisBit = 0b0000000000000001 << thisNote
                    noteBits = thisBit | noteBits // add bit to noteBits
                    triggerDisplayNote(thisNote)
                }
                sendToInstruments("RabP", noteBits)
                break
            case "d":
                let mumNoteBits = 0b0000000000000000
                for (let j = 1; j < thisData.length; j++) {
                    let thisNote = parseInt(thisData[j])
                    let thisBit = 0b0000000000000001 << thisNote
                    mumNoteBits = thisBit | mumNoteBits // add bit to mumNoteBits
                    triggerMumDisplayNote(thisNote)
                }
                sendToInstruments("MumP", mumNoteBits)
                break
            case "c":
                // cat notes are transposed semitones, so they can be two digits.
                // they arrive "*" separated: c0*7*12
                let catNoteBits = 0b0000000000000000
                let catNotes = thisData.slice(1).split("*")
                for (let j = 0; j < catNotes.length; j++) {
                    let thisNote = parseInt(catNotes[j])
                    // ignore anything that will not fit the 16 bit mask
                    if (thisNote >= 0 && thisNote <= 15) {
                        let thisBit = 0b0000000000000001 << thisNote
                        catNoteBits = thisBit | catNoteBits // add bit to catNoteBits
                        triggerCatDisplayNote(thisNote)
                    }
                }
                sendToInstruments("CatP", catNoteBits)
                break
            case "M":
                //MUTE ON
                sendToInstruments("m", 0b100000000) // mute thumpers
                mute = true
                break
            case "m":
                //MUTE Off
                sendToInstruments("m", 0b000000000) // unmute thumpers
                mute = false
                break
            case "S":
                // SOLO ON
                solo = true
                let soloMusicianNumber = parseInt("" + thisData[1] + thisData[2])
                sendToControl("ms", soloMusicianNumber) // unmute musicians
                //console.log("solo musician " + soloMusicianNumber)
                break
            case "s":
                // SOLO OFF
                solo = false
                //basic.showIcon(IconNames.Heart,0)
                clearTimer = input.runningTime()
                sendToControl("uma", 0) // unmute musicians
                break
            case "t":
                let stepNumber = parseInt("" + thisData[1] + thisData[2])
                sendToControl("t", stepNumber)

                clearTimer = input.runningTime()
                hasCleared = false;
                let displayStepNumber = stepNumber % 4
                if (displayStepNumber < 2) {
                    led.plot(displayStepNumber, 0)//basic.showNumber(stepNumber, 1)
                } else {
                    led.plot(displayStepNumber + 1, 0)//basic.showNumber(stepNumber, 1)
                }

                break
            default:
                basic.showIcon(IconNames.Confused)
                music.play(music.createSoundExpression(WaveShape.Sine, 1500, 3000, 255, 0, 50, SoundExpressionEffect.Warble, InterpolationCurve.Logarithmic), music.PlaybackMode.InBackground)

                break
        }
    }
}

function triggerDisplayNote(thisNote: number) {
    displayNoteNumber = thisNote % 4
    clearTimer = input.runningTime()
    hasCleared = false;
    if (playTones) {
        //music.ringTone(440 + (displayNoteNumber * 100))
        switch (displayNoteNumber) {
            case 0:
                BDPLAY()
                break
            case 1:
                PERCPLAY()
                break
            case 2:
                SDPLAY()
                break
            case 3:
                PERCPLAY()
                break
        }
    }

    if (displayNoteNumber < 2) {
        led.plot(displayNoteNumber, 4)
    } else {
        led.plot(displayNoteNumber + 1, 4)
    }
}

function triggerMumDisplayNote(thisNote: number) {
    displayNoteNumber = thisNote % 4
    clearTimer = input.runningTime()
    hasCleared = false;
    led.plot(displayNoteNumber % 5, 3)
}

function triggerCatDisplayNote(thisNote: number) {
    displayNoteNumber = thisNote % 4
    clearTimer = input.runningTime()
    hasCleared = false;
    led.plot(displayNoteNumber % 5, 2)
}

function BDPLAY() {
    music.play(music.createSoundExpression(WaveShape.Sine, 1088, 0, 255, 0, 50, SoundExpressionEffect.None, InterpolationCurve.Logarithmic), music.PlaybackMode.InBackground)
}

function SDPLAY() {
    music.play(music.createSoundExpression(WaveShape.Noise, 5000, 0, 255, 0, 50, SoundExpressionEffect.None, InterpolationCurve.Logarithmic), music.PlaybackMode.InBackground)
}

function PERCPLAY() {
    music.play(music.createSoundExpression(WaveShape.Sine, 2500, 0, 255, 0, 50, SoundExpressionEffect.Warble, InterpolationCurve.Logarithmic), music.PlaybackMode.InBackground)
}


//RECEIVE SCORES:
//THEY ARE SENT LIKE THIS radio.sendValue("S"+playerNumber, myScore)
radio.onReceivedValue(function (name: string, value: number) {
    //check that the name starts with S and is immediately folowed by a "-" or "0"-"9"
    if (name.charAt(0) == "S" && (name.charAt(1) == "-" || (name.charAt(1) >= "0" && name.charAt(1) <= "9"))) {
        serial.writeValue(name, value)
        led.plot(1, 2)
        //led.toggleAll()
    }
})

/*
input.onLogoEvent(TouchButtonEvent.Pressed, function() {
    led.toggle(1,1);
    radio.sendString("SCORE");
})
*/