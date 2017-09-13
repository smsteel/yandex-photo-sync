const electron = require('electron');
const main = electron.remote.require('./main.js');
const tokenButton = document.getElementById('token');
const albumProgressBar = document.querySelector('#progress-albums > .bar');
const photosProgressBar = document.querySelector('#progress-photos > .bar');

electron.ipcRenderer.on('done', () => {
    tokenButton.disabled = false;
});

electron.ipcRenderer.on('progress', (_, currentAlbum, totalAlbums, currentPhoto, totalPhotos) => {
    showProgress(albumProgressBar, currentAlbum, totalAlbums);
    showProgress(photosProgressBar, currentPhoto, totalPhotos);
});

function showProgress(bar, current, total) {
    bar.style.width = `${current / total * 100}%`;
    bar.innerText = `${current} из ${total}`;
}

tokenButton.addEventListener('click', () => {
    tokenButton.disabled = true;
    main.createTokenWindow();
});
