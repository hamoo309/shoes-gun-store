import Image, {type ImageProps} from 'next/image';

/** External merchant CDN images load in the browser; only local media uses the server optimizer. */
export default function StoreImage(props:ImageProps){const external=typeof props.src==='string'&&/^https?:\/\//i.test(props.src);return <Image {...props} unoptimized={external||props.unoptimized}/>;}
