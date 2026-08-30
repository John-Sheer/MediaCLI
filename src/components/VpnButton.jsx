import { useEffect, useState } from "react";
import { Shield, ShieldOff } from "lucide-react";

export default function VpnButton({ torActive, onToggle }) {
  const [status, setStatus] = useState(torActive);

  useEffect(() => { setStatus(torActive); }, [torActive]);

  return (
    <button
      onClick={() => onToggle(!torActive)}
      className={`relative flex items-center gap-2 px-2.5 py-2 rounded-md font-mono text-[12px] font-medium tracking-wider transition-all duration-300 active:scale-[0.96] border ${
        status
          ? "bg-[#040406] border-green-500/30 text-white/90 shadow-[0_0_16px_-4px_rgba(34,197,94,0.2)]"
          : "bg-[#040406] border-[#ff3b5c]/25 text-white/80 hover:text-white/80 hover:border-[#ff3b5c]/40"
      }`}
      title={status ? "TorVPN actif" : "TorVPN inactif"}
    >
      <span className="relative flex h-2.5 w-2.5">
        {status && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/70" />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 transition-colors duration-300 ${
          status ? "bg-[#a3e635]" : "bg-[#ff3b5c]"
        }`} />
      </span>
      {status ? <Shield className="w-4 h-4 text-green-400" /> : <ShieldOff className="w-4 h-4" />}
      <span>{status ? "VPN" : "VPN"}</span>
    </button>
  );
}
