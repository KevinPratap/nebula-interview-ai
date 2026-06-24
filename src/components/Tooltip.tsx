import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipProps {
    children: React.ReactElement;
    label: string;
    description?: string;
    shortcut?: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    delay?: number;
    disabled?: boolean;
}

const Tooltip: React.FC<TooltipProps> = ({
    children,
    label,
    description,
    shortcut,
    position = 'bottom',
    delay = 0.4,
    disabled = false
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, height: 0 });
    const [tooltipOffset, setTooltipOffset] = useState(0);
    const triggerRef = useRef<HTMLElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const updateCoords = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setCoords({
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
            });
        }
    };

    const handleMouseEnter = () => {
        updateCoords();
        setIsVisible(true);
    };

    const handleMouseLeave = () => {
        setIsVisible(false);
        setTooltipOffset(0);
    };

    // Smart positioning logic: shift tooltip if it hits viewport edges
    React.useLayoutEffect(() => {
        if (isVisible && tooltipRef.current) {
            const tooltipRect = tooltipRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const margin = 60; // Maintain a safe distance from edges

            let offset = 0;
            if (tooltipRect.left < margin) {
                offset = margin - tooltipRect.left;
            } else if (tooltipRect.right > viewportWidth - margin) {
                offset = viewportWidth - margin - tooltipRect.right;
            }

            if (offset !== 0) {
                setTooltipOffset(offset);
            }
        }
    }, [isVisible]);

    // Use cloneElement to avoid wrapper div layout shifts
    const child = React.cloneElement(children as React.ReactElement<any>, {
        ref: triggerRef,
        onMouseEnter: (e: any) => {
            handleMouseEnter();
            if ((children.props as any).onMouseEnter) (children.props as any).onMouseEnter(e);
        },
        onMouseLeave: (e: any) => {
            handleMouseLeave();
            if ((children.props as any).onMouseLeave) (children.props as any).onMouseLeave(e);
        }
    });

    return (
        <>
            {child}
            {!disabled && typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isVisible && (
                        <motion.div
                            ref={tooltipRef}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.15, delay: delay }}
                            className={`premium-tooltip tooltip-${position} ${description ? 'has-description' : ''}`}
                            style={{
                                position: 'fixed',
                                top: coords.top + ((position === 'bottom') ? coords.height + 12 : -12),
                                left: coords.left + (coords.width / 2) + tooltipOffset,
                                transform: `translateX(-50%) ${position === 'top' ? 'translateY(-100%)' : ''}`,
                                zIndex: 100000,
                                pointerEvents: 'none',
                                width: 'max-content'
                            }}
                        >
                            <div className="tooltip-header">
                                <span className="tooltip-label">{label}</span>
                                {shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
                            </div>
                            {description && (
                                <div className="tooltip-description">
                                    {description}
                                </div>
                            )}
                            <div className="tooltip-arrow" />
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};

export default Tooltip;
