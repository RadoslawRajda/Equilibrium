import React, { useState, useEffect } from 'react';
import { 
  Wheat, TreePine, Pickaxe, Gem, BatteryCharging, 
  ShoppingBag, LogOut, ChevronDown,
  ArrowRight, Send, History, Users, Sparkles,
  Signal, BatteryMedium, Building2, Landmark, Info
} from 'lucide-react';
import { PkoLogoIcon } from '../utils/helpers/customIcons';

type AssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
};

interface IkoPhoneProps {
  isOpen: boolean;
  onClose: () => void;
  highContrastEnabled?: boolean;
  bankSellKind: string;
  setBankSellKind: (val: string) => void;
  bankBuyKind: string;
  setBankBuyKind: (val: string) => void;
  bankBulkLots: number;
  setBankBulkLots: (val: number) => void;
  bankTradeBulkMaxLots: number;
  tradeEnergyCost: number;
  tradeOfferDraft: Record<string, number>;
  setTradeOfferDraft: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  tradeRequestDraft: Record<string, number>;
  setTradeRequestDraft: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  openTradeOffersCount: number;
  onTradeExecute: () => void; 
  onBarterCreate: () => void; 
  onOpenOffersList: () => void;
  // Assistant props
  assistantMessages: AssistantChatMessage[];
  assistantPrompt: string;
  setAssistantPrompt: (val: string) => void;
  assistantSending: boolean;
  assistantError: string | null;
  onSendAssistantPrompt: () => void;
  // Player resources
  playerResources: Record<string, number>;
  // Trade notifications
  tradeSuccessNotification: boolean;
  tradeSuccessMessage: string;
}

const RESOURCE_MAP = [
  { label: "food", icon: Wheat, color: "#ffd369" },
  { label: "wood", icon: TreePine, color: "#5bff9d" },
  { label: "stone", icon: Pickaxe, color: "#96b7ff" },
  { label: "ore", icon: Gem, color: "#ff9f6e" },
  { label: "energy", icon: BatteryCharging, color: "#56f0ff" }
];

export const IkoPhone: React.FC<IkoPhoneProps> = (props) => {
  const [activeTab, setActiveTab] = useState<'bank' | 'market' | 'assistant'>('bank');
  const [openSelect, setOpenSelect] = useState<'sell' | 'buy' | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (!props.isOpen) return null;

  const isHC = Boolean(props.highContrastEnabled);

  const colors = {
    pkoBlue: isHC ? '#ffe600' : '#002855',
    pkoRed: '#e60000',
    bgLight: isHC ? '#111111' : '#F2F4F7',
    border: isHC ? '#5f5f5f' : '#e0e4e8',
    inputBg: isHC ? '#1b1b1b' : '#f7f7f7',
    inputText: isHC ? '#ffe600' : '#5f666d',
    surface: isHC ? '#121212' : '#ffffff',
    surfaceSoft: isHC ? '#1a1a1a' : '#f0f2f5',
    statusBg: isHC ? '#101010' : '#ffffff',
    statusText: isHC ? '#ffe600' : '#000000',
    buttonPrimary: isHC ? '#5f5f5f' : '#002855',
    buttonSecondary: isHC ? '#4d4d4d' : '#f0f2f5',
    buttonDisabled: isHC ? '#363636' : '#cccccc',
    buttonText: isHC ? '#ffe600' : '#ffffff'
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const commonInputStyle = {
    background: colors.inputBg,
    color: colors.inputText,
    border: `1px solid ${colors.border}`,
    borderRadius: '10px',
    padding: '12px',
    fontSize: '13px',
    fontWeight: 'bold' as const,
    outline: 'none',
    width: '100%'
  };

  const CustomSelect = ({ value, onSelect, type }: { value: string, onSelect: (v: string) => void, type: 'sell' | 'buy' }) => {
    const selected = RESOURCE_MAP.find(r => r.label === value) || RESOURCE_MAP[0];
    const isThisOpen = openSelect === type;

    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <div 
          style={{ ...commonInputStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} 
          onClick={() => setOpenSelect(isThisOpen ? null : type)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <selected.icon size={18} color={selected.color} />
            <span>{selected.label.toUpperCase()}</span>
          </div>
          <ChevronDown size={16} style={{ transform: isThisOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
        </div>

        {isThisOpen && (
          <div style={{ 
            position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: '4px',
            background: colors.surface, borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            zIndex: 100, overflow: 'hidden', border: `1px solid ${colors.border}`
          }}>
            {RESOURCE_MAP.map((res) => (
              <div 
                key={res.label} 
                onMouseEnter={() => setHoveredItem(res.label)}
                onMouseLeave={() => setHoveredItem(null)}
                onClick={() => { onSelect(res.label); setOpenSelect(null); }}
                style={{
                  display: 'flex', alignItems: 'center', padding: '12px 16px',
                  fontSize: '12px', fontWeight: 'bold', cursor: 'pointer',
                  background: (hoveredItem === res.label || value === res.label) ? colors.surfaceSoft : 'transparent',
                  color: (hoveredItem === res.label || value === res.label) ? colors.pkoBlue : colors.inputText
                }}
              >
                <res.icon size={16} color={res.color} style={{ marginRight: '10px' }} />
                {res.label.toUpperCase()}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', background: isHC ? 'rgba(0, 0, 0, 0.88)' : 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(10px)' }}>
      <div style={{ position: 'absolute', inset: 0 }} onClick={props.onClose} />

      <div style={{
        position: 'relative', width: '360px', height: '740px', backgroundColor: '#000',
        border: isHC ? '12px solid #5f5f5f' : '12px solid #222', borderRadius: '45px', boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>
        
        {/* STATUS BAR */}
        <div style={{ height: '38px', background: colors.statusBg, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 28px', fontSize: '13px', color: colors.statusText, fontWeight: '600' }}>
          <span>{formatTime(currentTime)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Signal size={15} strokeWidth={2.5} />
            <span style={{ fontSize: '10px', marginRight: '2px' }}>5G</span>
            <BatteryMedium size={18} strokeWidth={2} />
          </div>
        </div>
        {/* SUCCESS NOTIFICATION - Push style */}
        {props.tradeSuccessNotification && (
          <div style={{
            position: 'absolute',
            top: '50px',
            left: '12px',
            right: '12px',
            background: '#34C759',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '12px',
            fontSize: '13px',
            fontWeight: 'bold',
            boxShadow: '0 8px 16px rgba(52, 199, 89, 0.3)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'slideDown 0.3s ease-out forwards, slideUp 0.3s ease-in 2.7s forwards'
          }}>
            <span>{props.tradeSuccessMessage}</span>
            <style>{`
              @keyframes slideDown {
                from {
                  transform: translateY(-100%);
                  opacity: 0;
                }
                to {
                  transform: translateY(0);
                  opacity: 1;
                }
              }
              @keyframes slideUp {
                from {
                  transform: translateY(0);
                  opacity: 1;
                }
                to {
                  transform: translateY(-100%);
                  opacity: 0;
                }
              }
            `}</style>
          </div>
        )}

        {/* HEADER - Zredukowany padding */}
        <div style={{ padding: '0px 16px',paddingBottom: '8px', background: colors.statusBg, borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center' }}>
            <PkoLogoIcon size={30} />
            <span style={{ fontWeight: '900', color: colors.pkoBlue, fontSize: '19px', marginLeft: '6px', letterSpacing: '-0.5px' }}>IKO</span>
        </div>

        <div className="iko-scroll-area" style={{ flex: 1, overflowY: 'auto', background: colors.bgLight, padding: '12px 16px', paddingBottom: '110px' }}>
          
          {activeTab === 'bank' && (
            <>
              {/* SECTION INFO - Zredukowany margines górny */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '20px', fontWeight: '900', color: colors.pkoBlue }}>Bank PKO Exchange</div>
                <p style={{ fontSize: '11.5px', color: '#5f666d', marginTop: '4px', lineHeight: '1.4' }}>
                  Exchange your resources instantly at a <strong>stable and guaranteed</strong> market rate.
                </p>
              </div>

              <div style={{ background: colors.surface, borderRadius: '16px', padding: '16px', marginBottom: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', border: `1px solid ${colors.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <Landmark size={18} color={colors.pkoBlue} />
                  <span style={{ fontSize: '14px', fontWeight: '800', color: colors.pkoBlue }}>Official Banking Rates</span>
                </div>
                
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                  {/* Rate - Przyciemniony tekst */}
                  <div style={{ flex: 1, background: colors.surfaceSoft, padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Info size={14} color={colors.pkoBlue} />
                    <div style={{ fontSize: '11px', color: colors.pkoBlue }}>Rate: <strong>4:1</strong></div>
                  </div>
                  {/* Fee - Przyciemniony tekst */}
                  <div style={{ flex: 1, background: colors.surfaceSoft, padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BatteryCharging size={14} color="#00a3b8" />
                    <div style={{ fontSize: '11px', color: colors.pkoBlue }}>Fee: <strong>{props.tradeEnergyCost}</strong></div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button style={{ flex: 1, padding: '12px', background: colors.buttonSecondary, color: colors.buttonText, border: `1px solid ${colors.border}`, borderRadius: '10px', fontWeight: 'bold', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <History size={14}/> History
                  </button>
                </div>
              </div>

              <div style={{ background: colors.surface, borderRadius: '16px', padding: '16px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: '900', color: colors.pkoBlue, marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>SELL RESOURCES (X4)</span>
                    <span style={{ fontSize: '9px', fontWeight: 'normal', color: colors.inputText }}>Have: {Math.floor((props.playerResources[props.bankSellKind] ?? 0) / 4)}</span>
                  </label>
                  <CustomSelect value={props.bankSellKind} onSelect={props.setBankSellKind} type="sell" />
                </div>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: '900', color: colors.pkoBlue, marginBottom: '6px', display: 'block' }}>RECEIVE RESOURCE (X1)</label>
                  <CustomSelect value={props.bankBuyKind} onSelect={props.setBankBuyKind} type="buy" />
                </div>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: '900', color: colors.pkoBlue, marginBottom: '6px', display: 'block' }}>QUANTITY (LOTS)</label>
                  <input type="number" min={1} max={props.bankTradeBulkMaxLots} value={props.bankBulkLots} onChange={(e) => props.setBankBulkLots(Number(e.target.value))} style={commonInputStyle} />
                </div>

                {/* Resources validation */}
                {(() => {
                  const sellResourceAmount = props.playerResources[props.bankSellKind] ?? 0;
                  const requiredAmount = props.bankBulkLots * 4;
                  const hasEnoughResources = sellResourceAmount >= requiredAmount;
                  
                  return (
                    <>
                      {!hasEnoughResources && (
                        <div style={{ 
                          background: '#ffe8e8', 
                          border: '1px solid #ff6b6b', 
                          borderRadius: '8px', 
                          padding: '10px', 
                          fontSize: '11px',
                          color: '#c92a2a'
                        }}>
                          <strong>Not enough resources!</strong> Need {requiredAmount} {props.bankSellKind},you have {sellResourceAmount}
                        </div>
                      )}
                      <button 
                        onClick={props.onTradeExecute} 
                        disabled={!hasEnoughResources}
                        style={{ 
                          width: '100%', 
                          padding: '12px', 
                          background: hasEnoughResources ? colors.buttonPrimary : colors.buttonDisabled,
                          color: colors.buttonText,
                          border: `1px solid ${colors.border}`,
                          borderRadius: '10px', 
                          fontWeight: 'bold', 
                          fontSize: '13px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '6px',
                          cursor: hasEnoughResources ? 'pointer' : 'not-allowed'
                        }}
                      >
                        <Send size={14}/> Transfer
                      </button>
                    </>
                  );
                })()}
              </div>
            </>
          )}

          {activeTab === 'market' && (
            <>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '20px', fontWeight: '900', color: colors.pkoBlue }}>P2P Global Market</div>
                <p style={{ fontSize: '11.5px', color: '#5f666d', marginTop: '4px', lineHeight: '1.4' }}>
                  Create custom trade listings or browse offers from the global community.
                </p>
              </div>
              
              <button onClick={props.onOpenOffersList} style={{ width: '100%', padding: '14px', background: colors.surface, border: `1.5px solid ${colors.border}`, color: colors.pkoBlue, borderRadius: '14px', fontWeight: '900', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Users size={20}/>
                    <span style={{ fontSize: '13px' }}>BROWSE GLOBAL OFFERS</span>
                </div>
                <span style={{ background: colors.pkoRed, color: '#fff', padding: '2px 10px', borderRadius: '20px', fontSize: '11px' }}>{props.openTradeOffersCount}</span>
              </button>

              <div style={{ background: colors.surface, borderRadius: '16px', padding: '16px', border: `1px solid ${colors.border}` }}>
                <div style={{ fontSize: '10px', fontWeight: '900', marginBottom: '16px', textAlign: 'center', color: colors.pkoBlue }}>CREATE NEW LISTING</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 34px 1fr', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '8.5px', fontWeight: '900', color: colors.inputText, textAlign: 'center' }}>YOU GIVE</div>
                    {RESOURCE_MAP.map(res => (
                      <div key={res.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <res.icon size={15} color={res.color} />
                        <input type="number" style={{ ...commonInputStyle, padding: '6px 8px', fontSize: '12px' }} value={props.tradeOfferDraft[res.label] || 0} onChange={(e) => props.setTradeOfferDraft(prev => ({...prev, [res.label]: Number(e.target.value)}))} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', color: colors.pkoBlue, opacity: 0.9, paddingTop: '15px' }}>
                    <ArrowRight size={20}/>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '8.5px', fontWeight: '900', color: colors.inputText, textAlign: 'center' }}>YOU WANT</div>
                    {RESOURCE_MAP.map(res => (
                      <div key={res.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <res.icon size={15} color={res.color} />
                        <input type="number" style={{ ...commonInputStyle, padding: '6px 8px', fontSize: '12px' }} value={props.tradeRequestDraft[res.label] || 0} onChange={(e) => props.setTradeRequestDraft(prev => ({...prev, [res.label]: Number(e.target.value)}))} />
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={props.onBarterCreate} style={{ width: '100%', marginTop: '20px', padding: '14px', background: colors.buttonPrimary, color: colors.buttonText, border: `1px solid ${colors.border}`, borderRadius: '12px', fontWeight: 'bold' }}>Publish Offer</button>
              </div>
            </>
          )}

          {activeTab === 'assistant' && (
            <>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '20px', fontWeight: '900', color: colors.pkoBlue }}>AI Assistant</div>
                <p style={{ fontSize: '11.5px', color: '#5f666d', marginTop: '4px', lineHeight: '1.4' }}>
                  Ask about rules, strategy, or get advice for the current game situation.
                </p>
              </div>

                <div style={{ background: colors.surface, borderRadius: '16px', padding: '16px', border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '0', height: '85%' }}>
                {/* Messages container */}
                <div className="iko-scroll-area" style={{
                  background: colors.bgLight,
                  borderRadius: '12px',
                  padding: '12px',
                  flex: 1,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  marginBottom: '12px'
                }}>
                  {props.assistantMessages.length === 0 ? (
                    <p style={{ fontSize: '11px', color: colors.inputText, margin: 0, textAlign: 'center', paddingTop: '20px' }}>
                      Ask about rules or strategy for the current lobby situation.
                    </p>
                  ) : (
                    props.assistantMessages.map((msg, idx) => (
                      <div 
                        key={`${msg.role}-${idx}`}
                        style={{
                          color: colors.inputText,
                          background: msg.role === 'user' ? colors.surfaceSoft : colors.inputBg,
                          borderLeft: `3px solid ${msg.role === 'user' ? colors.pkoBlue : colors.border}`,
                          padding: '10px',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                      >
                        <strong style={{ fontSize: '10px', display: 'block', marginBottom: '4px', color: colors.pkoBlue }}>
                          {msg.role === 'user' ? 'You' : 'Assistant'}
                        </strong>
                        <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* Input area - pinned at bottom */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 0, flexShrink: 0 }}>
                  <textarea
                    value={props.assistantPrompt}
                    onChange={(e) => props.setAssistantPrompt(e.target.value)}
                    placeholder="Type your question..."
                    style={{
                      ...commonInputStyle,
                      padding: '10px',
                      fontSize: '12px',
                      fontWeight: 'normal' as const,
                      minHeight: '60px',
                      resize: 'none'
                    }}
                    disabled={props.assistantSending}
                  />
                  <button
                    onClick={() => props.onSendAssistantPrompt()}
                    disabled={props.assistantSending || !props.assistantPrompt.trim()}
                    style={{
                      padding: '12px',
                      background: props.assistantSending || !props.assistantPrompt.trim() ? colors.buttonDisabled : colors.buttonPrimary,
                      color: colors.buttonText,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '10px',
                      fontWeight: 'bold',
                      fontSize: '12px',
                      cursor: props.assistantSending || !props.assistantPrompt.trim() ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <Send size={14} /> {props.assistantSending ? 'Sending...' : 'Send'}
                  </button>
                  {/* {props.assistantError && (
                    <p style={{ fontSize: '10px', color: colors.pkoRed, margin: 0 }}>{props.assistantError}</p>
                  )} */}
                </div>
              </div>
            </>
          )}
        </div>

        {/* NAVIGATION & HOME INDICATOR */}
        <div style={{ 
          position: 'absolute', bottom: 0, width: '100%', height: '95px', 
          background: colors.statusBg, borderTop: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%', flex: 1 }}>
            <NavButton active={activeTab === 'bank'} icon={<Building2 size={24}/>} label="Bank" onClick={() => setActiveTab('bank')} highContrastEnabled={isHC} />
            <NavButton active={activeTab === 'market'} icon={<ShoppingBag size={24}/>} label="Market" onClick={() => setActiveTab('market')} badge={props.openTradeOffersCount} highContrastEnabled={isHC} />
            <NavButton active={activeTab === 'assistant'} icon={<Sparkles size={24}/>} label="AI" onClick={() => setActiveTab('assistant')} highContrastEnabled={isHC} />
            <NavButton active={false} icon={<LogOut size={24}/>} label="Exit" onClick={props.onClose} highContrastEnabled={isHC} />
          </div>
          
          {/* IPHONE HOME INDICATOR */}
          <div style={{ width: '120px', height: '5px', background: isHC ? '#ffe600' : '#000', borderRadius: '10px', marginBottom: '8px', opacity: 0.8 }} />
        </div>
      </div>
    </div>
  );
};

const NavButton = ({ active, icon, label, onClick, badge, highContrastEnabled = false }: any) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      onClick={onClick} 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        gap: '4px', 
        cursor: 'pointer', 
        // Kolor zmienia się płynnie na hover, jeśli przycisk nie jest aktywny
        color: highContrastEnabled
          ? (active ? '#ffe600' : (isHovered ? '#fff066' : '#bfbfbf'))
          : (active ? '#002855' : (isHovered ? '#334b6e' : '#6a7077')),
        flex: 1, 
        position: 'relative',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', // Płynna animacja
        transform: isHovered ? 'translateY(-2px) scale(1.05)' : 'translateY(0) scale(1)',
      }}
    >
      <div style={{ 
        position: 'relative',
        // Delikatny blask ikony na hover
        filter: isHovered && !active
          ? (highContrastEnabled ? 'drop-shadow(0 0 5px rgba(255, 230, 0, 0.28))' : 'drop-shadow(0 0 5px rgba(0, 40, 85, 0.2))')
          : 'none'
      }}>
        {icon}
        {badge > 0 && (
          <div style={{ 
            position: 'absolute', 
            top: '-5px', 
            right: '-10px', 
            background: '#e60000', 
            color: '#fff', 
            fontSize: '10px', 
            fontWeight: 'bold', 
            minWidth: '18px', 
            height: '18px', 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            border: highContrastEnabled ? '2px solid #121212' : '2px solid #fff',
            // Powiadomienie może lekko "pulsować" na hover
            transform: isHovered ? 'scale(1.1)' : 'scale(1)',
            transition: 'transform 0.2s ease'
          }}>
            {badge}
          </div>
        )}
      </div>
      <span style={{ 
        fontSize: '10px', 
        fontWeight: active ? '900' : '600',
        letterSpacing: isHovered ? '0.2px' : 'normal',
        transition: 'letter-spacing 0.2s ease'
      }}>
        {label}
      </span>
    </div>
  );
};