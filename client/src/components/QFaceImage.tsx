import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  acquireQFaceDisplayImage,
  getQQFaceItem,
  getQFaceObjectUrl,
  isQFaceImageDecoded,
  markQFaceImageRendered,
  QFaceLoadPriority,
  releaseQFaceDisplayImage,
  requestQFaceImage,
  subscribeQFaceImageState,
  type QFaceLoadPriority as QFacePriority,
} from '../lib/qface';
import Tooltip from './Tooltip';

interface Props {
  id: string;
  className?: string;
  /** 悬停显示表情名；外层已有 Tooltip 时传 false */
  tooltip?: boolean;
  /** P0：当前可见区域 */
  priority?: QFacePriority;
  /** P1：即将进入视野（rootMargin 预取） */
  nearPriority?: QFacePriority;
  /** IntersectionObserver root，如聊天滚动区 / 表情面板 */
  observeRoot?: Element | null;
  placeholderClassName?: string;
}

const NEAR_ROOT_MARGIN = '96px';

function isPaintReady(state: string): boolean {
  return state === 'loaded' || state === 'decoded' || state === 'rendered';
}

export default function QFaceImage({
  id,
  className,
  tooltip = true,
  priority = QFaceLoadPriority.PANEL,
  nearPriority = QFaceLoadPriority.NEAR,
  observeRoot = null,
  placeholderClassName,
}: Props) {
  const face = getQQFaceItem(id);
  const rootRef = useRef<HTMLSpanElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(() => (
    isQFaceImageDecoded(id) || Boolean(getQFaceObjectUrl(id))
  ));

  useEffect(() => {
    return subscribeQFaceImageState(id, (state) => {
      if (isPaintReady(state)) setReady(true);
    });
  }, [id]);

  useEffect(() => {
    if (isQFaceImageDecoded(id)) return;

    const anchor = rootRef.current;
    if (!anchor) return;

    const schedule = (loadPriority: QFacePriority) => {
      void requestQFaceImage(id, loadPriority);
    };

    if (getQFaceObjectUrl(id)) {
      schedule(priority);
    }

    const visibleObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) schedule(priority);
      },
      { root: observeRoot, threshold: 0.01 },
    );

    const nearObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) schedule(nearPriority);
      },
      { root: observeRoot, rootMargin: NEAR_ROOT_MARGIN, threshold: 0.01 },
    );

    visibleObserver.observe(anchor);
    nearObserver.observe(anchor);
    return () => {
      visibleObserver.disconnect();
      nearObserver.disconnect();
    };
  }, [id, nearPriority, observeRoot, priority]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;

    const img = acquireQFaceDisplayImage(id, {
      className,
      alt: face.text,
    });
    if (!img) return;

    let cancelled = false;
    let revealFrame: number | null = null;
    const reveal = () => {
      if (cancelled) return;
      img.style.opacity = '1';
      markQFaceImageRendered(id);
    };
    const onLoad = () => {
      if (img.decode) {
        void img.decode().then(reveal, reveal);
      } else {
        reveal();
      }
    };

    img.style.opacity = '0';
    img.style.transition = 'opacity 120ms ease-out';
    host.replaceChildren(img);

    if (img.complete && img.naturalWidth > 0) {
      revealFrame = requestAnimationFrame(reveal);
    } else {
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', reveal, { once: true });
    }

    return () => {
      cancelled = true;
      if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', reveal);
      releaseQFaceDisplayImage(id, img);
      host.replaceChildren();
    };
  }, [className, face.text, id, ready]);

  const sizeClass = placeholderClassName || className || '';
  const faceContent = (
    <span
      ref={rootRef}
      className={`inline-flex items-center justify-center align-middle ${sizeClass}`.trim()}
    >
      <span
        ref={hostRef}
        className="inline-flex max-h-full max-w-full items-center justify-center [&_img]:max-h-full [&_img]:max-w-full"
      />
    </span>
  );

  if (!tooltip) return faceContent;

  return (
    <Tooltip content={face.text} side="bottom">
      {faceContent}
    </Tooltip>
  );
}
