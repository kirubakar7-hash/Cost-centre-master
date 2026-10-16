import Image from 'next/image';
import logo from '../../public/solidpro-logo.png';

/** Brand rule: never stretch, recolour, outline or add effects. Fixed aspect ratio, white background. */
export function Logo({ height = 36 }: { height?: number }) {
  return (
    <Image
      src={logo}
      alt="SolidPro — Place for Possibilities"
      height={height}
      style={{ height, width: 'auto' }}
      priority
    />
  );
}
