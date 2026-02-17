interface IconProps {
  size?: number;
  className?: string;
}

export function CopyIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 2H15V4H6V17H4V2ZM8 6H20V22H8V6ZM10 8V20H18V8H10Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ZapIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 1H14V9H22V11V13H20V11H14H12V9V5H10V3H12V1ZM8 7V5H10V7H8ZM6 9V7H8V9H6ZM4 11V9H6V11H4ZM14 19V21H12V23H10V15H2V13V11H4V13H10H12V15V19H14ZM16 17V19H14V17H16ZM18 15V17H16V15H18ZM18 15H20V13H18V15Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MoreHorizontalIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1 9H7V15H1V9ZM3 11V13H5V11H3ZM9 9H15V15H9V9ZM11 11V13H13V11H11ZM17 9H23V15H17V9ZM19 11V13H21V11H19Z"
        fill="currentColor"
      />
    </svg>
  );
}
