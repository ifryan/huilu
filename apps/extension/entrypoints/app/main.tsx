import { RouterProvider } from '@tanstack/react-router'
import { mount } from '@/lib/mount'
import { router } from './router'

void mount(<RouterProvider router={router} />)
