interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange?: (tabId: string) => void;
}

const Tabs = ({
  tabs,
  activeTab,
  onTabChange = () => {},
}: TabsProps) => {
  return (
    <div className="inline-flex gap-1 p-1 bg-bg-secondary rounded-lg">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            px-4 py-2 rounded-md text-sm font-medium
            transition-all duration-normal
            inline-flex items-center gap-2
            ${
              activeTab === tab.id
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }
          `}
        >
          {tab.icon && <span className="w-4 h-4">{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default Tabs;
