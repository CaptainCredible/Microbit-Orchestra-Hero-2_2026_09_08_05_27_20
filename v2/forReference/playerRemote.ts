let controllerNumber = 1

let basicMode = false
let myLedTimer = 0
let rabbitNames = ["Ali","Eir","Ina","Una","Per","Alf","Ada","Ela","Eli","Mor",
"Oda","Ask","Kai","Ida","Kim","Eva"]
let sendName = rabbitNames[controllerNumber]
let myMusicianNumber = controllerNumber
basic.showString(sendName, 50)
let myLedIsOn = true
if (input.buttonIsPressed(Button.A)) {
    OrchestraMusician.setUpAsMusician(myMusicianNumber)
    OrchestraMusician.makeASimpleSequencer(
    numberofSteps.four,
    sendName,0,1,2,3)
    basicMode = false
} else if (input.buttonIsPressed(Button.B)) {
    OrchestraMusician.setUpAsMusician(myMusicianNumber)
    OrchestraMusician.makeASimpleSequencer(
    numberofSteps.eight,
    sendName,0,1,2,3)
    basicMode = false
} else {
    basic.showIcon(IconNames.SmallDiamond)
    OrchestraMusician.microbitOrchestraHero(controllerNumber)
    basicMode = true
    OrchestraMusician.onButtonBPressed(function () {

        if (basicMode) {
            myLedTimer = input.runningTime()
            myLedIsOn = true
            led.plot(4, 1)
            led.plot(4, 2)
            led.plot(4, 3)
            
            // OrchestraMusician.send(2, "sendName")
            radio.setGroup(83)
            radio.sendValue(sendName, 2)
            radio.setGroup(84)
        }
    })
OrchestraMusician.onButtonAPressed(function () {
        if (basicMode) {
            myLedTimer = input.runningTime()
            myLedIsOn = true
            led.plot(0, 1)
            led.plot(0, 2)
            led.plot(0, 3)

            // OrchestraMusician.send(0, "sendName")
            radio.setGroup(83)
            radio.sendValue(sendName, 0)
            radio.setGroup(84)
        }
    })
}
basic.forever(function () {
    if (myLedIsOn) {
        if (input.runningTime() > myLedTimer + 30) {
            basic.clearScreen()
            basic.showIcon(IconNames.SmallDiamond, 0)
            if (myScore != 0) {
                led.plot(2,2)
            }
myLedIsOn = false
        }
    }
})
