import { BrowserWindow, app, ipcMain, globalShortcut, IpcMainEvent, WebContents } from 'electron';
import AyayaLeague from './LeagueReader';
import { createOverlayWindow, createSettingsWindow } from './overlay/Windows'
import { loadSettingsFromFile, setSettings, saveSettingsToFile, getSettings } from './overlay/Settings'
import { Settings } from './overlay/models/Settings';
import { Vector2 } from './models/Vector';
import { Preparator } from './overlay/Preparator';
import { matrixToArray } from './utils/Utils';
import { Performance } from './utils/Performance';

import { UserScriptManager } from '../scripts/UserScriptManager';
import { CachedClass } from './models/CachedClass';

if (process.argv[2] == 'nohook') {
    AyayaLeague.reader.setMode("DUMP");
    AyayaLeague.reader.loadDump();
} else {
    AyayaLeague.reader.hookLeagueProcess();
}

const preparator = new Preparator(AyayaLeague);

let overlayWindow: BrowserWindow;
let settingsWindow: BrowserWindow;

let highestReadTime = 0;

let renderer: number;
let screen: Vector2;

function sendMessageToWin(win: BrowserWindow | WebContents, name: string, data: any) {
    if (win['webContents']) return (win as BrowserWindow).webContents.send(name, JSON.stringify(data));
    return (win as WebContents).send(name, JSON.stringify(data));
}
function onMessage<T>(name: string, cb: (e: IpcMainEvent, message: T) => void) {
    ipcMain.on(name, (e, message) => {
        if (message == undefined || message == 'undefined') return cb(e, undefined);
        cb(e, JSON.parse(message));
    });
}
function registerHandlers() {

    onMessage<Settings>('updateSettings', (e, data) => {
        setSettings(data);
        saveSettingsToFile();
        sendMessageToWin(overlayWindow, 'dataSettings', data);
        sendMessageToWin(settingsWindow, 'dataSettings', data);
    });

    onMessage<never>('requestSettings', (e, data) => {
        const settings = getSettings();
        sendMessageToWin(e.sender, 'dataSettings', settings);
    });

    onMessage<never>('requestScreenSize', (e, data) => {
        renderer = renderer || AyayaLeague.getRenderBase();
        screen = screen || AyayaLeague.getScreenSize(renderer);
        sendMessageToWin(e.sender, 'dataScreenSize', screen);
    });

    onMessage<never>('closeSettingsWindow', (e, data) => {
        settingsWindow.hide();
    });




    onMessage<never>('reloadWindows', (e, data) => {
        overlayWindow.reload();
        settingsWindow.reload();
    });

    onMessage<never>('openOverlayDevTools', (e, data) => {
        overlayWindow.webContents.openDevTools();
    });
}

function main() {

    loadSettingsFromFile();
    registerHandlers();

    overlayWindow = createOverlayWindow();
    settingsWindow = createSettingsWindow();

    renderer = AyayaLeague.getRenderBase();
    screen = AyayaLeague.getScreenSize(renderer);
    overlayWindow.setSize(screen.x, screen.y);

    //* SHORTCUTS
    globalShortcut.register('CommandOrControl+Space', () => {
        settingsWindow.isVisible() ? settingsWindow.hide() : settingsWindow.show();
    });

    loop();

}


const performance = new Performance();

function loop() {
    performance.start();

    //* Create UserScriptManager
    const manager = new UserScriptManager();

    //* Load required global variables
    const gameTime = AyayaLeague.getGameTime();
    const me = manager.me;
    const myTeam = me.team;
    const nmeTeam = myTeam == 100 ? 200 : 100;
    const matrix = matrixToArray(AyayaLeague.getViewProjectionMatrix());

    //* Put global variables into global cache
    CachedClass.set('screen', screen);
    CachedClass.set('matrix', matrix);
    CachedClass.set('gameTime', gameTime);
    CachedClass.set('myTeam', myTeam);
    CachedClass.set('nmeTeam', nmeTeam);


    const finalData = {
        me: preparator.prepareChampion(me),
        enemyChampions: manager.champions.enemies.map(e => preparator.prepareChampion(e)),
        missiles: manager.missiles.map(preparator.prepareMissile),
        performance: { time: 0, max: parseFloat(highestReadTime.toFixed(1)) },
        screen,
        matrix
    }

    // --- performance ---
    const result = performance.end();
    if (result.time > highestReadTime) highestReadTime = result.time;
    // --- performance ---

    finalData.performance.time = result.time;
    sendMessageToWin(overlayWindow, 'gameData', finalData);
    const settings = getSettings();
    setTimeout(loop, Math.max(result.time + settings.root.readingTime, 10));
}

app.whenReady().then(main);


app.on('will-quit', () => {
    globalShortcut.unregisterAll()
});