import React, { useState } from 'react';
import {
    syncAllData,
    syncProjectsOnly,
    syncOffersOnly,
    syncHoursForYear,
    syncRecentHours,
    SyncResponse
} from '../services/api';
import { Button } from '@/components/ui/button';

interface SyncButtonProps {
    onClick: () => Promise<void>;
    disabled: boolean;
    loading: boolean;
    children: React.ReactNode;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

interface SyncPageProps {
    onReturn?: () => void; // Optional callback to return to revenue page
}

const SyncButton: React.FC<SyncButtonProps> = ({
    onClick,
    disabled,
    loading,
    children,
    variant = 'default'
}) => (
    <Button
        onClick={onClick}
        disabled={disabled || loading}
        variant={variant}
        className="w-full text-xs h-9"
    >
        {loading ? 'Synchroniseren...' : children}
    </Button>
);

const SyncPage: React.FC<SyncPageProps> = ({ onReturn }) => {
    console.log('[SyncPage] Component geladen'); // Debug log

    // State for each sync operation's status
    const [syncAllStatusLoading, setSyncAllStatusLoading] = useState(false);
    const [syncAllStatusSuccess, setSyncAllStatusSuccess] = useState(false);
    const [syncAllStatusError, setSyncAllStatusError] = useState<string | null>(null);

    const [syncProjectsStatusLoading, setSyncProjectsStatusLoading] = useState(false);
    const [syncProjectsStatusSuccess, setSyncProjectsStatusSuccess] = useState(false);
    const [syncProjectsStatusError, setSyncProjectsStatusError] = useState<string | null>(null);

    const [syncOffersStatusLoading, setSyncOffersStatusLoading] = useState(false);
    const [syncOffersStatusSuccess, setSyncOffersStatusSuccess] = useState(false);
    const [syncOffersStatusError, setSyncOffersStatusError] = useState<string | null>(null);

    const [syncRecentHoursStatusLoading, setSyncRecentHoursStatusLoading] = useState(false);
    const [syncRecentHoursStatusSuccess, setSyncRecentHoursStatusSuccess] = useState(false);
    const [syncRecentHoursStatusError, setSyncRecentHoursStatusError] = useState<string | null>(null);

    const [syncHoursYears, setSyncHoursYears] = useState<{[year: number]: {
        loading: boolean;
        success: boolean;
        error: string | null;
    }}>({
        2018: { loading: false, success: false, error: null },
        2019: { loading: false, success: false, error: null },
        2020: { loading: false, success: false, error: null },
        2021: { loading: false, success: false, error: null },
        2022: { loading: false, success: false, error: null },
        2023: { loading: false, success: false, error: null },
        2024: { loading: false, success: false, error: null },
        2025: { loading: false, success: false, error: null },
        2026: { loading: false, success: false, error: null }
    });

    // Handles sync response and updates state accordingly
    const handleSyncResponse = (
        response: SyncResponse,
        setLoading: React.Dispatch<React.SetStateAction<boolean>>,
        setSuccess: React.Dispatch<React.SetStateAction<boolean>>,
        setError: React.Dispatch<React.SetStateAction<string | null>>
    ) => {
        setLoading(false);
        if (response.success) {
            setSuccess(true);
            setError(null);
        } else {
            setSuccess(false);
            setError(response.error || 'Onbekende fout');
        }
    };

    // Sync for a specific year
    const handleSyncHoursForYear = async (year: number, forceDeleteAll: boolean = false) => {
        setSyncHoursYears(prev => ({
            ...prev,
            [year]: { loading: true, success: false, error: null }
        }));

        try {
            const response = await syncHoursForYear(year, forceDeleteAll);
            setSyncHoursYears(prev => ({
                ...prev,
                [year]: {
                    loading: false,
                    success: response.success || false,
                    error: response.success ? null : (response.error || 'Onbekende fout')
                }
            }));
        } catch {
            setSyncHoursYears(prev => ({
                ...prev,
                [year]: { loading: false, success: false, error: 'Netwerk fout' }
            }));
        }
    };

    // Handlers for each sync operation
    const handleSyncAll = async () => {
        setSyncAllStatusLoading(true);
        setSyncAllStatusSuccess(false);
        setSyncAllStatusError(null);

        try {
            const response = await syncAllData();
            handleSyncResponse(response, setSyncAllStatusLoading, setSyncAllStatusSuccess, setSyncAllStatusError);
        } catch {
            handleSyncResponse({
                success: false,
                error: 'Netwerk fout',
                message: 'Synchronisatie mislukt door netwerk fout'
            }, setSyncAllStatusLoading, setSyncAllStatusSuccess, setSyncAllStatusError);
        }
    };

    const handleSyncProjects = async () => {
        setSyncProjectsStatusLoading(true);
        setSyncProjectsStatusSuccess(false);
        setSyncProjectsStatusError(null);

        try {
            const response = await syncProjectsOnly();
            handleSyncResponse(response, setSyncProjectsStatusLoading, setSyncProjectsStatusSuccess, setSyncProjectsStatusError);
        } catch {
            handleSyncResponse({
                success: false,
                error: 'Netwerk fout',
                message: 'Synchronisatie mislukt door netwerk fout'
            }, setSyncProjectsStatusLoading, setSyncProjectsStatusSuccess, setSyncProjectsStatusError);
        }
    };

    const handleSyncOffers = async () => {
        setSyncOffersStatusLoading(true);
        setSyncOffersStatusSuccess(false);
        setSyncOffersStatusError(null);

        try {
            const response = await syncOffersOnly();
            handleSyncResponse(response, setSyncOffersStatusLoading, setSyncOffersStatusSuccess, setSyncOffersStatusError);
        } catch {
            handleSyncResponse({
                success: false,
                error: 'Netwerk fout',
                message: 'Synchronisatie mislukt door netwerk fout'
            }, setSyncOffersStatusLoading, setSyncOffersStatusSuccess, setSyncOffersStatusError);
        }
    };

    const handleSyncRecentHours = async () => {
        setSyncRecentHoursStatusLoading(true);
        setSyncRecentHoursStatusSuccess(false);
        setSyncRecentHoursStatusError(null);

        try {
            const response = await syncRecentHours();
            handleSyncResponse(response, setSyncRecentHoursStatusLoading, setSyncRecentHoursStatusSuccess, setSyncRecentHoursStatusError);
        } catch {
            handleSyncResponse({
                success: false,
                error: 'Netwerk fout',
                message: 'Synchronisatie mislukt door netwerk fout'
            }, setSyncRecentHoursStatusLoading, setSyncRecentHoursStatusSuccess, setSyncRecentHoursStatusError);
        }
    };

    // Render status indicator icon (success/error/none)
    const renderStatusIcon = (success: boolean, error: string | null) => {
        if (success) return <span className="text-green-500 text-sm">✓</span>;
        if (error) return <span className="text-red-500 text-sm">✗</span>;
        return null;
    };

    return (
        <div className="container mx-auto px-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-xl font-semibold">Synchronisatie Beheer</h1>
                <Button onClick={onReturn} variant="outline" size="sm" className="h-8 text-xs flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Terug naar Omzet
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {/* Volledige Synchronisatie */}
                <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200">
                    <h2 className="text-base font-medium mb-2">Volledige Synchronisatie</h2>
                    <p className="text-xs text-gray-500 mb-3">Synchroniseert alle projecten, offertes en uren. Dit kan lang duren.</p>
                    <div className="flex items-center gap-2">
                        <SyncButton
                            onClick={handleSyncAll}
                            disabled={syncAllStatusLoading || syncProjectsStatusLoading || syncOffersStatusLoading}
                            loading={syncAllStatusLoading}
                            variant="destructive"
                        >
                            Alles Synchroniseren
                        </SyncButton>
                        {renderStatusIcon(syncAllStatusSuccess, syncAllStatusError)}
                    </div>
                    {syncAllStatusError && (
                        <p className="mt-2 text-xs text-red-500">{syncAllStatusError}</p>
                    )}
                </div>

                {/* Projecten & Offertes */}
                <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200">
                    <h2 className="text-base font-medium mb-2">Projecten & Offertes</h2>
                    <div className="grid gap-2">
                        <div className="flex items-center gap-2">
                            <SyncButton
                                onClick={handleSyncProjects}
                                disabled={syncAllStatusLoading || syncProjectsStatusLoading}
                                loading={syncProjectsStatusLoading}
                            >
                                Alle Projecten
                            </SyncButton>
                            {renderStatusIcon(syncProjectsStatusSuccess, syncProjectsStatusError)}
                        </div>

                        <div className="flex items-center gap-2">
                            <SyncButton
                                onClick={handleSyncOffers}
                                disabled={syncAllStatusLoading || syncOffersStatusLoading}
                                loading={syncOffersStatusLoading}
                            >
                                Alle Offertes
                            </SyncButton>
                            {renderStatusIcon(syncOffersStatusSuccess, syncOffersStatusError)}
                        </div>
                    </div>
                </div>

                {/* Recente Uren */}
                <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200">
                    <h2 className="text-base font-medium mb-2">Recente Uren</h2>
                    <p className="text-xs text-gray-500 mb-3">Alleen uren uit de afgelopen 3 maanden synchroniseren.</p>
                    <div className="flex items-center gap-2">
                        <SyncButton
                            onClick={handleSyncRecentHours}
                            disabled={syncAllStatusLoading || syncRecentHoursStatusLoading}
                            loading={syncRecentHoursStatusLoading}
                        >
                            Recente Uren
                        </SyncButton>
                        {renderStatusIcon(syncRecentHoursStatusSuccess, syncRecentHoursStatusError)}
                    </div>
                </div>

                {/* Uren per Jaar */}
                <div className="bg-white p-4 rounded-md shadow-sm border border-gray-200">
                    <h2 className="text-base font-medium mb-2">Uren per Jaar</h2>
                    <div className="grid gap-2">
                        {Object.entries(syncHoursYears).map(([year, status]) => (
                            <div key={year} className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <SyncButton
                                        onClick={() => handleSyncHoursForYear(parseInt(year))}
                                        disabled={syncAllStatusLoading || status.loading}
                                        loading={status.loading}
                                    >
                                        Uren {year}
                                    </SyncButton>
                                    {renderStatusIcon(status.success, status.error)}
                                </div>
                                {parseInt(year) === 2025 && (
                                    <div className="flex items-center gap-2">
                                        <SyncButton
                                            onClick={() => handleSyncHoursForYear(parseInt(year), true)}
                                            disabled={syncAllStatusLoading || status.loading}
                                            loading={status.loading}
                                            variant="destructive"
                                        >
                                            Uren {year} (FORCE)
                                        </SyncButton>
                                        <span className="text-xs text-gray-500">⚠️ Verwijdert alle uren</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SyncPage;