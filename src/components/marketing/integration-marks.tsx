export function WhatsAppMark({ size = 28 }: { size?: number }) {
    return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#25864b" /><path d="M8 24.5 9.2 20.3a9.2 9.2 0 1 1 3.4 3.1L8 24.5Z" stroke="white" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12.2 10.8c-.4-.1-1.2.6-1.2 1.6 0 2.8 4.4 7.1 7.1 7.1 1 0 1.8-.8 1.7-1.3l-2-1.2c-.3-.2-.5-.1-.7.2l-.6.7c-1.5-.6-2.9-2-3.5-3.4l.7-.7c.2-.2.3-.4.1-.7l-1.6-2.3Z" fill="white" /></svg>;
}

export function GoogleCalendarMark({ size = 28 }: { size?: number }) {
    return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285f4" d="M6 0h6v12H0V6a6 6 0 0 1 6-6Z" /><path fill="#1a73e8" d="M12 0h24v12H12Z" /><path fill="#1967d2" d="M36 0h6a6 6 0 0 1 6 6v6H36ZM0 12h12v24H0Z" /><path fill="#ea4335" d="M36 12h12v24H36Z" /><path fill="#fbbc04" d="M36 36h12L36 48Z" /><path fill="#34a853" d="M12 36h24v12H12Z" /><path fill="#188038" d="M0 36h12v12Z" /><path fill="#fff" d="M12 12h24v24H12Z" /><text x="24" y="29" textAnchor="middle" fill="#1a73e8" fontSize="17" fontFamily="Arial, sans-serif">31</text></svg>;
}
