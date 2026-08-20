import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store/store';
import { Loader } from 'lucide-react';

interface ProgressiveLoaderProps {
  criticalContent: React.ReactNode;
  nonCriticalContent: React.ReactNode;
  loadDelay?: number;
  placeholder?: React.ReactNode;
}

export const ProgressiveLoader: React.FC<ProgressiveLoaderProps> = ({
  criticalContent,
  nonCriticalContent,
  loadDelay = 1000,
  placeholder = <Loader className="h-6 w-6 text-green-600 animate-spin" />
}) => {
  const [showNonCritical, setShowNonCritical] = useState(false);
  const { connectionQuality, lowDataMode } = useSelector((state: RootState) => state.networkStatus);
  const isSlowConnection = connectionQuality === 'poor' || connectionQuality === 'slow';
  
  useEffect(() => {
    // For slow connections or low data mode, delay loading non-critical content
    const timeoutDuration = isSlowConnection || lowDataMode 
      ? loadDelay * 2.5  // Longer delay for slow connections
      : loadDelay;
    
    const timer = setTimeout(() => {
      setShowNonCritical(true);
    }, timeoutDuration);
    
    return () => clearTimeout(timer);
  }, [isSlowConnection, lowDataMode, loadDelay]);

  return (
    <>
      {/* Critical content loads immediately */}
      {criticalContent}
      
      {/* Non-critical content loads after delay */}
      {showNonCritical ? (
        nonCriticalContent
      ) : (
        <div className="py-4 flex justify-center">
          {placeholder}
        </div>
      )}
    </>
  );
};
