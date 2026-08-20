import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store/store';
import { Loader } from 'lucide-react';

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  lowQualitySrc?: string;
  placeholderColor?: string;
  loading?: 'lazy' | 'eager';
}

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  width,
  height,
  className = '',
  lowQualitySrc,
  placeholderColor = '#f3f4f6',
  loading = 'lazy'
}) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const { isLowBandwidth } = useSelector((state: RootState) => state.networkStatus);
  
  useEffect(() => {
    // Always start by using lowQualitySrc or null
    setImgSrc(lowQualitySrc || null);
    
    if (isLowBandwidth && lowQualitySrc) {
      // In low bandwidth mode, use the low quality source permanently
      setImgSrc(lowQualitySrc);
      setIsLoaded(true);
    } else {
      // Otherwise, load the full quality image
      const img = new Image();
      img.src = src;
      
      img.onload = () => {
        setImgSrc(src);
        setIsLoaded(true);
      };
      
      img.onerror = () => {
        // Keep the low quality image on error, or show error state
        if (!lowQualitySrc) {
          setIsError(true);
        }
      };
    }
  }, [src, lowQualitySrc, isLowBandwidth]);

  // Style for placeholder while loading
  const placeholderStyle = {
    backgroundColor: placeholderColor,
    width: width ? `${width}px` : '100%',
    height: height ? `${height}px` : '100%',
  };

  if (isError && !imgSrc) {
    return (
      <div 
        style={placeholderStyle}
        className={`flex items-center justify-center ${className}`}
      >
        <span className="text-gray-400 text-sm">Failed to load image</span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div 
        style={placeholderStyle}
        className={`flex items-center justify-center ${className}`}
      >
        <Loader className="h-6 w-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  // If the image is loaded but it's just the low quality version in non-low-bandwidth mode
  // then we'll show that while the full quality one loads
  return (
    <img
      src={imgSrc || ''}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading={loading}
    />
  );
};
