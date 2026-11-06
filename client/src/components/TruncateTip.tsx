import { createElement, memo, type ElementType } from 'react';
import Tooltip, { type TooltipSide } from './Tooltip';

interface Props {
  text: string;
  className?: string;
  as?: ElementType;
  side?: TooltipSide;
}

function isElementTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
}

function TruncateTip({
  text,
  className,
  as: Tag = 'span',
  side = 'bottom',
}: Props) {
  return (
    <Tooltip content={text} side={side} shouldShow={isElementTruncated} tapToShow>
      {createElement(Tag, { className }, text)}
    </Tooltip>
  );
}

export default memo(TruncateTip);
