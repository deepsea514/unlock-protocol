import Head from 'next/head'
import { pageTitle } from '../../constants'
import { AppLayout, FOOTER } from '../interface/layouts/AppLayout'
import { SubscriptionLandingPage } from './subscription/SubscriptionLandingPage'
import { useRouter } from 'next/navigation'

export const SubscriptionContent = () => {
  const router = useRouter()

  return (
    <AppLayout
      showFooter={{ ...FOOTER, subscriptionForm: undefined }}
      showLinks={false}
      authRequired={false}
      logoRedirectUrl="/subscription"
      logoImageUrl="/images/svg/logo-unlock-subscriptions.svg"
    >
      <Head>
        <title>{pageTitle('Onchain subscriptions')}</title>
      </Head>

      <SubscriptionLandingPage
        handleCreateSubscription={() => {
          router.push(
            'https://unlock-protocol-19942922.hs-sites.com/unlock-subscription-signup'
          )
        }}
      />
    </AppLayout>
  )
}

export default SubscriptionContent
