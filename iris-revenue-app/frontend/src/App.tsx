import { useState, useEffect } from 'react';
import RevenuePage from './pages/RevenuePage';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup
} from '@/components/ui/dropdown-menu';
import {
  syncAllData,
  syncProjectsOnly,
  syncOffersOnly,
  syncRecentHours,
  syncHoursForYear
} from './services/api';
import useRevenueStore from './store/revenueStore';
// import './globals.css';

function App() {
  const [syncLoading, setSyncLoading] = useState<boolean>(false);
  const [syncSuccess, setSyncSuccess] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Get the invalidateCache function from the store
  const { invalidateCache } = useRevenueStore();

  // Reset success/error messages after 3 seconds
  useEffect(() => {
    if (syncSuccess || syncError) {
      const timer = setTimeout(() => {
        setSyncSuccess(false);
        setSyncError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [syncSuccess, syncError]);

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      maxWidth: "100%",
      display: "flex",
      flexDirection: "column",
      fontSize: "14px",
      backgroundColor: "#f9fafb",
      paddingLeft: "40px",
      paddingRight: "40px",
      boxSizing: "border-box"
    }}>
      {/* Header met navigatie */}
      <header className="border-b border-gray-200 bg-white shadow-sm py-2">
        <div
          className="px-8"
          style={{
            width: "100%",
            maxWidth: "100%",
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <h1 className="text-lg font-semibold tracking-tight">IRIS Revenue App</h1>
          <nav className="flex gap-3">

            {/* Status indicator */}
            {syncSuccess && (
              <div className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                Synchronisatie geslaagd
              </div>
            )}
            {syncError && (
              <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                {syncError}
              </div>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-md text-sm font-medium bg-white text-gray-800 border-gray-300"
                  disabled={syncLoading}
                >
                  {syncLoading ? 'Bezig...' : 'Synchronisatie'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* Main Sync Options */}
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={async () => {
                    setSyncLoading(true);
                    setSyncSuccess(false);
                    setSyncError(null);
                    try {
                      const response = await syncAllData();
                      if (response.success) {
                        setSyncSuccess(true);
                        // Invalidate all cache after successful sync
                        invalidateCache();
                      } else {
                        setSyncError(response.error || 'Fout bij synchroniseren');
                      }
                    } catch {
                      setSyncError('Netwerk fout bij synchroniseren');
                    } finally {
                      setSyncLoading(false);
                    }
                  }}>
                    Alles Synchroniseren
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => {
                    setSyncLoading(true);
                    setSyncSuccess(false);
                    setSyncError(null);
                    try {
                      const response = await syncProjectsOnly();
                      if (response.success) {
                        setSyncSuccess(true);
                        // Invalidate all cache after successful sync
                        invalidateCache();
                      } else {
                        setSyncError(response.error || 'Fout bij synchroniseren');
                      }
                    } catch {
                      setSyncError('Netwerk fout bij synchroniseren');
                    } finally {
                      setSyncLoading(false);
                    }
                  }}>
                    Alle Projecten
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => {
                    setSyncLoading(true);
                    setSyncSuccess(false);
                    setSyncError(null);
                    try {
                      const response = await syncOffersOnly();
                      if (response.success) {
                        setSyncSuccess(true);
                        // Invalidate all cache after successful sync
                        invalidateCache();
                      } else {
                        setSyncError(response.error || 'Fout bij synchroniseren');
                      }
                    } catch {
                      setSyncError('Netwerk fout bij synchroniseren');
                    } finally {
                      setSyncLoading(false);
                    }
                  }}>
                    Alle Offertes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => {
                    setSyncLoading(true);
                    setSyncSuccess(false);
                    setSyncError(null);
                    try {
                      const response = await syncRecentHours();
                      if (response.success) {
                        setSyncSuccess(true);
                        // Invalidate cache for the current year
                        const currentYear = new Date().getFullYear();
                        invalidateCache(currentYear);
                      } else {
                        setSyncError(response.error || 'Fout bij synchroniseren');
                      }
                    } catch {
                      setSyncError('Netwerk fout bij synchroniseren');
                    } finally {
                      setSyncLoading(false);
                    }
                  }}>
                    Recente Uren
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                {/* Hours by Year */}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Uren per Jaar</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {[2026, 2025, 2024, 2023, 2022].map(year => (
                    <DropdownMenuItem key={year} onClick={async () => {
                      setSyncLoading(true);
                      setSyncSuccess(false);
                      setSyncError(null);
                      try {
                        // Gebruik de nieuwe API-endpoint
                        const response = await syncHoursForYear(year);
                        if (response.success) {
                          setSyncSuccess(true);
                          // Invalidate cache for the specific year
                          invalidateCache(year);
                        } else {
                          setSyncError(response.error || 'Fout bij synchroniseren');
                        }
                      } catch {
                        setSyncError('Netwerk fout bij synchroniseren');
                      } finally {
                        setSyncLoading(false);
                      }
                    }}>
                      Uren {year}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main style={{
        flexGrow: 1,
        padding: "16px 0",
      }}>
        <RevenuePage />
      </main>
    </div>
  );
}

export default App
