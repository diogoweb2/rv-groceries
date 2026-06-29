import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Tag, Store, BookOpen, Waves } from 'lucide-react'

const sections = [
  { label: 'Amenities', description: 'Beach, pool, tennis…', icon: Waves, path: '/manage/amenities' },
  { label: 'Stores', description: 'Lidl, Aldi, pharmacy…', icon: Store, path: '/manage/stores' },
  { label: 'Saved items', description: 'Autocomplete list — remove unused items', icon: Tag, path: '/manage/catalog' },
  { label: 'Templates', description: 'Reusable checklists to add to any trip', icon: BookOpen, path: '/manage/templates' },
]

export function ManageHome() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-gray-800">Manage</h1>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
        {sections.map(s => (
          <button
            key={s.path}
            onClick={() => navigate(s.path)}
            className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 text-left hover:bg-gray-50"
          >
            <div className="bg-emerald-50 rounded-xl p-2.5">
              <s.icon className="w-5 h-5 text-[#2f6b4f]" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">{s.label}</p>
              <p className="text-sm text-gray-500">{s.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
