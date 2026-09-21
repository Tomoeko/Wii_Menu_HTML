/* Runs inside the isolated original page. It describes a rendered raster and
 * receives native-coordinate input; no page DOM is displayed by the host. */
(function installSettingsRasterBridge(window) {
  'use strict';
  const document = window.document;
  let configured = false;
  let dirty = true;
  let pending = false;
  let hovered = null;
  let sequence = 0;
  let lastMarkup = '';
  let latestInput = {};
  let fastIds = new Set();
  let fastDirty = false;
  let scheduled = false;
  const send = (action, data = {}) =>
    window.parent.postMessage({ type: 'wii-settings-raster', action, ...data }, '*');
  const frames = () => [...document.querySelectorAll('frame,iframe')];
  const frameSurfaces = new Map();
  const frameImageId = (index, id) => `frame-${index}:${id}`;
  const imageSources = () => frames().length
    ? frames().flatMap((frame, index) =>
      (frameSurfaces.get(frame.contentWindow)?.currentImages ?? []).map((image) => ({
        id: frameImageId(index, image.id),
        src: image.src,
      })),
    ).filter((image) => fastIds.has(image.id))
    : [...fastIds].map((id) => ({ id, src: document.getElementById(id).src }));

  function frameImages() {
    return frames().flatMap((frame, index) => {
      const surface = frameSurfaces.get(frame.contentWindow);
      if (!surface) return [];
      const bounds = frame.getBoundingClientRect();
      return (surface.images ?? []).filter((image) =>
        image.x >= 0 && image.y >= 0
        && image.x + image.width <= bounds.width
        && image.y + image.height <= bounds.height,
      ).map((image) => ({
        ...image,
        id: frameImageId(index, image.id),
        x: image.x + bounds.left,
        y: image.y + bounds.top,
        src: surface.currentImages.find((current) => current.id === image.id)?.src ?? image.src,
      }));
    });
  }
  // Hidden engines may have setTimeout/setInterval clamped to one second.
  // A message task coalesces mutations without that artificial navigation wait.
  const snapshotTasks = new window.MessageChannel();
  snapshotTasks.port1.onmessage = () => {
    scheduled = false;
    void snapshot().catch((error) => send('error', { message: String(error) }));
  };
  const schedule = () => {
    if (scheduled || !configured) return;
    scheduled = true;
    snapshotTasks.port2.postMessage(null);
  };
  const invalidate = () => {
    dirty = true;
    fastDirty = false;
    fastIds.clear();
    schedule();
  };
  const safeStyle = (computed) => {
    const result = [];
    for (const property of computed) {
      if (
        property.startsWith('-webkit-') ||
        property.startsWith('animation') ||
        property.startsWith('transition')
      )
        continue;
      const value = computed.getPropertyValue(property);
      // The WAD includes hidden optional-network icons whose CSS filenames
      // are absent from its archive. They paint nothing in Opera or browsers.
      // Retain their layout and visibility, without loading invisible images.
      const hiddenImage = computed.visibility === 'hidden' && /url\(/i.test(value);
      result.push(`${property}:${hiddenImage ? 'none' : value};`);
    }
    return result.join('');
  };
  function clone(node) {
    if (node.nodeType === 3) return document.createTextNode(node.textContent);
    if (node.nodeType !== 1 || /^(SCRIPT|LINK|STYLE|META|BASE|NOSCRIPT)$/.test(node.tagName))
      return null;
    const computed = window.getComputedStyle(node);
    if (computed.display === 'none') return null;
    // The frameset's child engines report independent snapshots. Replace only
    // their rendering with static positioned XHTML, retaining the native sizes.
    if (/^(FRAME|IFRAME)$/.test(node.tagName)) {
      const wrapper = document.createElement('div');
      const bounds = node.getBoundingClientRect();
      wrapper.setAttribute(
        'style',
        `position:absolute;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;overflow:hidden`,
      );
      const snapshot = frameSurfaces.get(node.contentWindow);
      if (snapshot) {
        wrapper.innerHTML = snapshot.markup;
        // A child can publish a verified image patch without rebuilding its
        // markup. Carry its current image state into any later full snapshot.
        const sources = new Map(snapshot.currentImages.map((image) => [image.id, image.src]));
        for (const image of wrapper.querySelectorAll('img[id]')) {
          if (sources.has(image.id)) image.setAttribute('src', sources.get(image.id));
        }
      }
      return wrapper;
    }
    const copy = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      /^(BODY|FRAMESET)$/.test(node.tagName) ? 'div' : node.tagName.toLowerCase(),
    );
    for (const attribute of node.attributes) {
      if (
        /^on/i.test(attribute.name) ||
        ['style', 'href', 'src', 'srcset', 'background', 'action', 'target', 'sandbox'].includes(
          attribute.name,
        )
      )
        continue;
      copy.setAttribute(attribute.name, attribute.value);
    }
    copy.setAttribute('style', safeStyle(computed));
    if (node.tagName === 'IMG' && computed.visibility !== 'hidden')
      copy.setAttribute('src', node.currentSrc || node.src);
    if (node.tagName === 'INPUT') copy.setAttribute('value', node.value);
    if (node.tagName === 'TEXTAREA') copy.textContent = node.value;
    else
      for (const child of node.childNodes) {
        const next = clone(child);
        if (next) copy.appendChild(next);
      }
    return copy;
  }
  async function snapshot() {
    if (!configured || (!dirty && !fastDirty) || pending || document.readyState !== 'complete')
      return;
    if (!dirty && fastDirty) {
      fastDirty = false;
      lastMarkup = '';
      send('image-patch', {
        baseSequence: sequence,
        path: window.location.pathname,
        ...latestInput,
        images: imageSources(),
      });
      return;
    }
    // Native UpdateTexture waits for the completed document. A frameset is
    // complete only after each child engine has supplied its first raster.
    if (frames().some((frame) => !frameSurfaces.has(frame.contentWindow))) return;
    pending = true;
    dirty = false;
    try {
      await window.WiiSettingsFontsReady;
      await document.fonts.ready;
      const body = clone(document.body || document.documentElement);
      if (!body) return;
      // HTML propagates the body's background to the viewport even when all
      // children are absolutely positioned. A nested static snapshot needs
      // that viewport-sized paint area explicitly.
      body.style.minWidth = `${window.innerWidth}px`;
      body.style.minHeight = `${window.innerHeight}px`;
      if (document.body?.tagName === 'FRAMESET') {
        body.style.display = 'block';
        body.style.position = 'relative';
        body.style.width = `${window.innerWidth}px`;
        body.style.height = `${window.innerHeight}px`;
      }
      const markup = new XMLSerializer().serializeToString(body);
      if (markup === lastMarkup) return;
      lastMarkup = markup;
      // Only original image-swap overlays can bypass complete DOM rendering.
      // The host verifies that every changed pixel can replace its contribution
      // exactly over the completed raster, without recovering hidden artwork.
      const images = frames().length
        ? frameImages()
        : [...document.querySelectorAll('img[id][onmouseover]')].flatMap((img) => {
            if (!/MM_swapImage\(/.test(img.getAttribute('onmouseover'))) return [];
            const bounds = img.getBoundingClientRect(),
              style = window.getComputedStyle(img);
            if (
              style.visibility !== 'visible' ||
              style.opacity !== '1' ||
              style.transform !== 'none' ||
              style.filter !== 'none' ||
              !bounds.width ||
              !bounds.height
            )
              return [];
            for (let parent = img.parentElement; parent; parent = parent.parentElement) {
              const parentStyle = window.getComputedStyle(parent);
              if (
                parentStyle.opacity !== '1' ||
                parentStyle.transform !== 'none' ||
                parentStyle.filter !== 'none' ||
                parentStyle.mixBlendMode !== 'normal'
              )
                return [];
              if (parentStyle.overflowX !== 'visible' || parentStyle.overflowY !== 'visible') {
                const clip = parent.getBoundingClientRect();
                if (
                  bounds.left < clip.left ||
                  bounds.right > clip.right ||
                  bounds.top < clip.top ||
                  bounds.bottom > clip.bottom
                )
                  return [];
              }
            }
            if (
              document.elementFromPoint(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2,
              ) !== img
            )
              return [];
            const alternates = [
              ...img
                .getAttribute('onmouseover')
                .matchAll(
                  /MM_swapImage\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/g,
                ),
            ].map((match) => new URL(match[1], window.location.href).href);
            return alternates.length
              ? [
                  {
                    id: img.id,
                    src: img.currentSrc || img.src,
                    alternates,
                    x: bounds.left,
                    y: bounds.top,
                    width: bounds.width,
                    height: bounds.height,
                  },
                ]
              : [];
          });
      send('snapshot', {
        sequence: ++sequence,
        path: window.location.pathname,
        width: window.innerWidth,
        height: window.innerHeight,
        markup,
        images,
        ...latestInput,
      });
    } finally {
      pending = false;
      if (dirty || fastDirty) schedule();
    }
  }
  function nicknameMarker(input, pointerX) {
    // The original Name input owns this stationary selection; it must not set
    // the software keyboard's independently animated insertion position.
    if (input?.tagName !== 'INPUT' || input.id !== 'Name') return null;
    const style = window.getComputedStyle(input);
    const bounds = input.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const value = String(input.value);
    const textWidth = context.measureText(value).width;
    const number = (property) => Number.parseFloat(style[property]) || 0;
    const leftInset = number('borderLeftWidth') + number('paddingLeft');
    const rightInset = number('borderRightWidth') + number('paddingRight');
    const available = bounds.width - leftInset - rightInset;
    let textLeft = bounds.left + leftInset - (input.scrollLeft || 0);
    if (style.textAlign === 'center') textLeft += (available - textWidth) / 2;
    else if (style.textAlign === 'right' || style.textAlign === 'end')
      textLeft += available - textWidth;
    let prefix = '';
    let nearest = textLeft;
    for (const character of value) {
      prefix += character;
      const position = textLeft + context.measureText(prefix).width;
      if (Math.abs(pointerX - position) < Math.abs(pointerX - nearest)) nearest = position;
    }
    const height = Math.min(bounds.height, number('fontSize'));
    return {
      x: Math.round(Math.max(bounds.left + leftInset, Math.min(
        bounds.right - rightInset - 1, nearest,
      ))),
      y: Math.round(bounds.top + (bounds.height - height) / 2),
      width: 1,
      height,
    };
  }
  function eventAt(data) {
    latestInput = { inputSequence: data.inputSequence, requestedAt: data.requestedAt };
    const x = data.x,
      y = data.y;
    const target = document.elementFromPoint(x, y);
    if (target !== hovered && /^(FRAME|IFRAME)$/.test(hovered?.tagName)) {
      hovered.contentWindow.postMessage({ ...data, action: 'move', x: -1, y: -1 }, '*');
    }
    if (/^(FRAME|IFRAME)$/.test(target?.tagName)) {
      const bounds = target.getBoundingClientRect();
      target.contentWindow.postMessage(
        { ...data, type: 'wii-settings-raster-input', x: x - bounds.left, y: y - bounds.top },
        '*',
      );
      hovered = target;
      return;
    }
    const mouse = (element, type, extra = {}) =>
      element?.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          ...extra,
        }),
      );
    if (target !== hovered) {
      mouse(hovered, 'mouseout', { relatedTarget: target });
      mouse(hovered, 'mouseleave', { bubbles: false, relatedTarget: target });
      mouse(target, 'mouseover', { relatedTarget: hovered });
      mouse(target, 'mouseenter', { bubbles: false, relatedTarget: hovered });
      hovered = target;
    }
    if (data.action === 'move') mouse(target, 'mousemove');
    else if (data.action === 'activate') {
      send('input-marker', { marker: nicknameMarker(target, x) });
      mouse(target, 'mousedown', { buttons: 1 });
      mouse(target, 'mouseup');
      target?.click();
    }
    // The original mouse handlers mutate src/style when the visual state
    // changes. Movement within the same control does not invalidate its page.
    // MutationObserver and load/input events request the necessary snapshots.
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source === window.parent) {
      if (data?.type === 'wii-settings-raster-configure') {
        configured = data.active !== false;
        invalidate();
        for (const frame of frames()) frame.contentWindow.postMessage(data, '*');
      } else if (data?.type === 'wii-settings-raster-input') eventAt(data);
      else if (
        data?.type === 'wii-settings-raster-fast-images' &&
        data.sequence === sequence &&
        !dirty
      ) {
        fastIds = new Set(data.ids);
        for (const [index, frame] of frames().entries()) {
          const child = frameSurfaces.get(frame.contentWindow);
          if (!child) continue;
          const prefix = frameImageId(index, '');
          frame.contentWindow.postMessage({
            type: 'wii-settings-raster-fast-images',
            sequence: child.sequence,
            ids: data.ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)),
          }, '*');
        }
      }
      else if (data?.type === 'wii-settings-raster-refresh') {
        lastMarkup = '';
        invalidate();
      }
      return;
    }
    if (data?.type !== 'wii-settings-raster') return;
    if (!frames().some((frame) => frame.contentWindow === event.source)) return;
    if (data.action === 'ready' && configured) {
      frameSurfaces.delete(event.source);
      event.source.postMessage({ type: 'wii-settings-raster-configure' }, '*');
    } else if (data.action === 'error') {
      // A failed child font load cannot supply its first raster. Keep the
      // frameset incomplete, but surface its failure instead of waiting silently
      // or combining another child's new snapshot with this child's old pixels.
      frameSurfaces.delete(event.source);
      invalidate();
      send('error', { message: data.message || 'An original Settings frame could not load.' });
    } else if (data.action === 'snapshot') {
      frameSurfaces.set(event.source, {
        ...data,
        currentImages: (data.images ?? []).map(({ id, src }) => ({ id, src })),
      });
      invalidate();
    } else if (data.action === 'image-patch') {
      const child = frameSurfaces.get(event.source);
      if (!child || child.sequence !== data.baseSequence) return;
      child.currentImages = data.images;
      // Only image IDs accepted by the host's pixel-compositing check may use
      // this path. Country's three frame engines otherwise force a full raster
      // with embedded fonts for every pointer crossing.
      if (dirty) return;
      fastDirty = true;
      schedule();
    }
  });
  document.addEventListener(
    'load',
    (event) => {
      if (event.target?.tagName === 'IMG' && fastIds.has(event.target.id)) return;
      invalidate();
    },
    true,
  );
  document.addEventListener('input', invalidate, true);
  document.addEventListener('change', invalidate, true);
  window.addEventListener('load', invalidate);
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') invalidate();
  });
  new MutationObserver((records) => {
    if (
      !dirty &&
      records.length &&
      records.every(
        (record) =>
          record.type === 'attributes' &&
          record.attributeName === 'src' &&
          fastIds.has(record.target.id),
      )
    ) {
      fastDirty = true;
      schedule();
    } else invalidate();
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  send('ready');
})(window);
