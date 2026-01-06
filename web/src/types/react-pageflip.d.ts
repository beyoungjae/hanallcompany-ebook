declare module "react-pageflip" {
  import * as React from "react";

  export type HTMLFlipBookProps = React.PropsWithChildren<{
    width: number;
    height: number;
    size?: "fixed" | "stretch";
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    usePortrait?: boolean;
    disableFlipByClick?: boolean;
    startPage?: number;
    className?: string;
    style?: React.CSSProperties;
    onFlip?: (e: { data: number }) => void;
  }>;

  const HTMLFlipBook: React.ForwardRefExoticComponent<
    HTMLFlipBookProps & React.RefAttributes<any>
  >;

  export default HTMLFlipBook;
}


