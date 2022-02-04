import SignaturePad from './signature-pad.js';

const wrapper = document.getElementById('signature-pad'),
  clearButton = wrapper.querySelector('[data-action="clear"]'),
  saveButton = wrapper.querySelector('[data-action="save"]'),
  canvas = wrapper.querySelector('canvas'),
  error = wrapper.querySelector('#error');

const sp = new SignaturePad(canvas, {
  throttle: 16,
  onEnd: (e) => error.classList.add('hidden'),
});

function resizeCanvas() {
  // will clear canvas on resize
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext('2d').scale(ratio, ratio);

  // if you want the signature to be kept on resize
  // could be cutoff based on screen orientation
  // let storedData = sp.toData();
  // sp.clear();
  // sp.fromData(storedData);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

clearButton.addEventListener('click', (e) => {
  sp.clear();
  error.classList.add('hidden');
});
saveButton.addEventListener('click', (e) => {
  if (sp.isEmpty()) {
    error.classList.remove('hidden');
    canvas.focus();
  } else {
    const str = sp.toDataURL();
    const iframe = `<iframe style="height: 100%; width: 100%; border: 0;" src="${str}"></iframe>`;
    const x = window.open();
    x.window.open();
    x.document.write(iframe);
    x.document.close();
  }
});
