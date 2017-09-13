const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const path = require('path');
const url = require('url');
const fs = require('fs');
const http = require('http');
const queryString = require('query-string');
const fetch = require('electron-fetch');
const loadJsonFile = require('load-json-file');

let mainWindow;
let tokenWindow;
let accessToken;
let savePath;
let totalAlbums = 0;
let totalPhotos = 0;
let processedAlbums = 0;
let processedPhotos = 0;
let clientId = '';
const apiUrl = 'https://api-fotki.yandex.ru/api';

function loadConfig() {
    loadJsonFile(path.join(__dirname, 'config.json'))
        .then((config) => {mainWindow.webContents.send('info', config);  clientId = config['clientId'] });
}

function createWindow(url) {
    let window = new BrowserWindow({width: 800, height: 600});
    window.loadURL(url);
    window.on('closed', function () {
        window = null
    });
    return window;
}

function createMainWindow () {
    mainWindow = createWindow(url.format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file:',
        slashes: true
    }));
    loadConfig();
}

exports.createTokenWindow = () => {
    tokenWindow = createWindow(`https://oauth.yandex.ru/authorize?response_type=token&client_id=${clientId}`);
};

function showProgress() {
    mainWindow.webContents.send('progress', processedAlbums, totalAlbums, processedPhotos, totalPhotos);
}

function receiveTokenFromCommandLine(commandLine) {
    let [, urlParam] = commandLine;
    let parsedUrl = url.parse(urlParam);
    let hash = parsedUrl.hash;
    if (!hash) {
        return;
    }
    let parsedHash = queryString.parse(hash);
    if (!parsedHash || !parsedHash['access_token']) {
        return;
    }
    accessToken = parsedHash['access_token'];
}

function synchronizePhotos() {
    totalAlbums = 0;
    totalPhotos = 0;
    processedPhotos = 0;
    processedAlbums = 0;
    getPath()
        .then(() => getAlbumListUrl())
        .then(url => getAlbumList(url))
        .then(albumList => processAlbumList(albumList))
        .then(() => mainWindow.webContents.send('done'))
}

function processAlbumList(albumList) {
    totalAlbums = albumList.length;
    let albumPromises = [];
    albumList.forEach((album) => { albumPromises.push(processAlbum(album)) });
    return Promise.all(albumPromises);
}

function processAlbum(album) {
    let albumTitle = album['title'];
    let photosUrl = album['links']['photos'];
    return getPhotos(photosUrl, albumTitle)
        .then((photos) => processPhotos(photos, albumTitle))
        .then(() => {
            processedAlbums += 1; showProgress();
        });
}

function processPhotos(photos, albumTitle) {
    totalPhotos += photos.length;
    let photoPromises = [];
    photos.forEach((photo) => {
        let photoPromise = processPhoto(photo, albumTitle)
            .then(() => { processedPhotos += 1; showProgress(); });
        photoPromises.push(photoPromise)
    });
    return Promise.all(photoPromises);
}

function processPhoto(photo, albumTitle) {
    return new Promise((resolve) => {
        if (isPhotoExistAndComplete(photo['img']['orig']['bytesize'], albumTitle, photo['title'])) {
            resolve();
        } else {
            getPhoto(photo['img']['orig']['href'], albumTitle, photo['title'])
                .then(() => { resolve(); });
        }
    });
}

function getPath() {
    return new Promise((resolve, reject) => {
        dialog.showOpenDialog(
            {properties: ['openDirectory']},
            (filePaths) => {
                if (typeof filePaths !== 'object' || filePaths.length !== 1) {
                    reject();
                }
                savePath = filePaths[0];
                resolve();
            }
        );
    });
}

function api(request) {
    return fetch(request, {headers: {'Accept': 'application/json', 'Authorization': `OAuth ${accessToken}`}})
}

function getAlbumListUrl() {
    return api(`${apiUrl}/me/`)
        .then(response => response.json())
        .then(json => json['collections']['album-list']['href']);
}

function getAlbumList(albumListUrl, albums) {
    albums = albums || [];
    return api(albumListUrl)
        .then(response => response.json())
        .then(json => {
            albums.push.apply(albums, json['entries']);
            if (json['links']['next']) {
                return getAlbumList(json['links']['next'], albums);
            }
            return albums;
        });
}

function getPhotos(photosUrl, albumTitle, photos) {
    photos = photos || [];
    return api(photosUrl)
        .then(response => response.json())
        .then(json => {
            photos.push.apply(photos, json['entries']);
            if (json['links']['next']) {
                return getPhotos(json['links']['next'], albumTitle, photos);
            }
            return photos;
        });
}

function ensurePath(dir) {
    let initDir = path.isAbsolute(dir) ? path.sep : '';
    dir.split(path.sep).reduce((parentDir, childDir) => {
        const curDir = path.resolve(parentDir, childDir);
        if (!fs.existsSync(curDir)) {
            fs.mkdirSync(curDir);
        }
        return curDir;
    }, initDir);
}

function getSavePath(directory) {
    return `${savePath}${path.sep}${directory}`;
}

function getPathWithFilename(directory, fileName) {
    return `${directory}${path.sep}${fileName}`;
}

function isPhotoExistAndComplete(byteSize, directory, fileName) {
    let path = getPathWithFilename(getSavePath(directory), fileName);
    if (fs.existsSync(path)) {
        let stats = fs.statSync(path);
        return stats.size === byteSize;
    } else {
        return false;
    }
}

function getPhoto(photoUrl, directory, fileName, attempt) {
    attempt = attempt || 0;
    return new Promise((resolve) => {
        api(photoUrl)
            .then(response => {
                directory = getSavePath(directory);
                ensurePath(directory);
                return writeFileStream(response.body, getPathWithFilename(directory, fileName));
            })
            .then(() => { resolve(); })
            .catch(() => {
                setTimeout(() => {
                    getPhoto(photoUrl, directory, fileName, attempt + 1)
                        .then(() => { resolve(); })
                }, Math.min(attempt, 5) * 5);
            })
    });
}

function writeFileStream(data, path) {
    return new Promise((resolve, reject) => {
        try {
            let destination = fs.createWriteStream(path);
            let stream = data.pipe(destination);
            stream.on('finish', () => {
                resolve();
            });
        } catch (_) {
            reject();
        }
    })
}

app.on('ready', () => {
    createMainWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createMainWindow()
  }
});

app.setAsDefaultProtocolClient('ya-photo');

const isSecondInstance = app.makeSingleInstance((commandLine) => {
    if (!mainWindow) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();
    if (!commandLine) {
        return;
    }
    receiveTokenFromCommandLine(commandLine);
    synchronizePhotos();
    if (tokenWindow) {
        tokenWindow.close();
    }
});

if (isSecondInstance) {
    app.quit()
}
