import ImagePreview from "../imagePreview";

interface ImagePreviewListProps {
    images: {id: string; src: string; alt?: string}[];
    onRemove: (id: string) => void;
}

const ImagePreviewList = ({images, onRemove}: ImagePreviewListProps) => {
    if (images.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 p-2">
            {images.map((image) => (
                <ImagePreview key={image.id} src={image.src} alt={image.alt} onRemove={() => onRemove(image.id)} />
            ))}
        </div>
    );
};

export default ImagePreviewList;
